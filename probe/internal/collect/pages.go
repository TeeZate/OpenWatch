// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

package collect

import (
	"crypto/tls"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	maxPagesPerFrontend = 40
	pageProbeTimeout    = 5 * time.Second
)

// ── Types ─────────────────────────────────────────────────────────────────────

// FrontendInfo captures everything discovered about one frontend origin.
type FrontendInfo struct {
	URL            string     `json:"url"`
	Framework      string     `json:"framework"`       // "Next.js" | "React" | "Vue.js" | ...
	TotalPages     int        `json:"total_pages"`
	PublicPages    int        `json:"public_pages"`
	ProtectedPages int        `json:"protected_pages"` // pages that redirect to /login etc.
	Pages          []PageInfo `json:"pages"`
	CollectedAt    string     `json:"collected_at"`
	Error          string     `json:"error,omitempty"`
}

// PageInfo captures what was discovered about a single page path.
type PageInfo struct {
	Path         string `json:"path"`
	Title        string `json:"title,omitempty"`
	AuthRequired bool   `json:"auth_required"`
	StatusCode   int    `json:"status_code"`
	RedirectsTo  string `json:"redirects_to,omitempty"`
}

// Sitemap XML helpers
type sitemapURL struct {
	Loc string `xml:"loc"`
}
type sitemapURLSet struct {
	URLs []sitemapURL `xml:"url"`
}
type sitemapIndex struct {
	Sitemaps []struct{ Loc string `xml:"loc"` } `xml:"sitemap"`
}

var (
	reTitleTag  = regexp.MustCompile(`(?i)<title[^>]*>([^<]{1,120})`)
	reHrefAttr  = regexp.MustCompile(`(?i)\shref=["']([^"'#?][^"']*?)["']`)
	reNextData  = regexp.MustCompile(`__NEXT_DATA__`)
	reNuxtData  = regexp.MustCompile(`__NUXT__|window\.__nuxt`)
	reVueMeta   = regexp.MustCompile(`(?i)(vuex|vue\.js|vue\.runtime)`)
	reAstroMeta = regexp.MustCompile(`(?i)(astro:|astro-island)`)
	reSvelteMeta= regexp.MustCompile(`(?i)(svelte-|__svelte)`)
)

var authPaths = []string{
	"/login", "/auth/", "/signin", "/sign-in",
	"/authentication", "/sso", "/oauth", "/session/new",
}

// ── Public entry point ────────────────────────────────────────────────────────

// CollectFrontendPages discovers pages, auth requirements, and framework for
// each frontend URL. Called once per extended collection cycle (~5 min).
func CollectFrontendPages(frontendURLs []string) []FrontendInfo {
	results := make([]FrontendInfo, 0, len(frontendURLs))
	for _, u := range frontendURLs {
		results = append(results, collectOneFrontend(u))
	}
	return results
}

// ── Per-frontend collection ───────────────────────────────────────────────────

func collectOneFrontend(rawURL string) FrontendInfo {
	info := FrontendInfo{
		URL:         rawURL,
		CollectedAt: time.Now().UTC().Format(time.RFC3339),
	}

	base, err := url.Parse(strings.TrimRight(rawURL, "/"))
	if err != nil {
		info.Error = fmt.Sprintf("invalid URL: %v", err)
		return info
	}

	// fetchClient follows redirects — used to read page bodies & sitemap.
	fetchClient := &http.Client{
		Timeout: pageProbeTimeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	// probeClient does NOT follow redirects — used so we can see WHERE a page
	// redirects to and decide if that's an auth wall.
	probeClient := &http.Client{
		Timeout: pageProbeTimeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	// Step 1 — load homepage to detect framework and seed the link crawler.
	homepageBody, homepageHeaders := fetchBody(fetchClient, rawURL)
	info.Framework = detectFramework(homepageHeaders, homepageBody)

	// Step 2 — discover page paths.
	paths := discoverPagePaths(fetchClient, rawURL, base, homepageBody)

	// Step 3 — probe each path for auth status + title.
	seen := map[string]bool{}
	for _, path := range paths {
		if seen[path] {
			continue
		}
		seen[path] = true

		pi := probePage(probeClient, fetchClient, base, path)
		info.Pages = append(info.Pages, pi)
		if pi.AuthRequired {
			info.ProtectedPages++
		} else {
			info.PublicPages++
		}
		if len(info.Pages) >= maxPagesPerFrontend {
			break
		}
	}

	info.TotalPages = len(info.Pages)
	return info
}

// ── Page discovery ────────────────────────────────────────────────────────────

func discoverPagePaths(client *http.Client, rawURL string, base *url.URL, homepageBody string) []string {
	seen := map[string]bool{"/": true}
	paths := []string{"/"}

	add := func(href string) {
		u, err := url.Parse(href)
		if err != nil {
			return
		}
		abs := base.ResolveReference(u)
		if abs.Hostname() != base.Hostname() {
			return
		}
		p := abs.Path
		if p == "" {
			p = "/"
		}
		if !seen[p] && !isAssetPath(p) {
			seen[p] = true
			paths = append(paths, p)
		}
	}

	// 1. Try /sitemap.xml
	if body, _ := fetchBody(client, rawURL+"/sitemap.xml"); body != "" {
		if urls := parseSitemap(body, base); len(urls) > 0 {
			for _, u := range urls {
				add(u)
			}
		}
	}

	// 2. Check robots.txt for Sitemap: directives
	if body, _ := fetchBody(client, rawURL+"/robots.txt"); body != "" {
		for _, line := range strings.Split(body, "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(strings.ToLower(trimmed), "sitemap:") {
				parts := strings.SplitN(trimmed, ":", 2)
				if len(parts) == 2 {
					smURL := strings.TrimSpace(parts[1])
					if !strings.HasPrefix(smURL, "http") {
						smURL = rawURL + smURL
					}
					if smBody, _ := fetchBody(client, smURL); smBody != "" {
						for _, u := range parseSitemap(smBody, base) {
							add(u)
						}
					}
				}
			}
		}
	}

	// 3. Extract <a href> links from homepage HTML (depth-1 crawl)
	for _, match := range reHrefAttr.FindAllStringSubmatch(homepageBody, 200) {
		if len(match) > 1 {
			href := match[1]
			// Skip common non-page hrefs
			if strings.HasPrefix(href, "mailto:") || strings.HasPrefix(href, "tel:") ||
				strings.HasPrefix(href, "javascript:") {
				continue
			}
			add(href)
		}
	}

	return paths
}

func parseSitemap(body string, base *url.URL) []string {
	var urls []string

	// Try as URL set
	var us sitemapURLSet
	if err := xml.Unmarshal([]byte(body), &us); err == nil && len(us.URLs) > 0 {
		for _, u := range us.URLs {
			urls = append(urls, u.Loc)
		}
		return urls
	}

	// Try as sitemap index (contains other sitemaps — just return their loc)
	var si sitemapIndex
	if err := xml.Unmarshal([]byte(body), &si); err == nil {
		for _, s := range si.Sitemaps {
			urls = append(urls, s.Loc)
		}
	}
	return urls
}

// ── Page probing ──────────────────────────────────────────────────────────────

func probePage(noRedirectClient, fetchClient *http.Client, base *url.URL, path string) PageInfo {
	pi := PageInfo{Path: path}
	pageURL := base.Scheme + "://" + base.Host + path

	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return pi
	}
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	req.Header.Set("User-Agent", "OpenWatch-PageProbe/1.0")

	resp, err := noRedirectClient.Do(req)
	if err != nil {
		return pi
	}
	defer resp.Body.Close()
	pi.StatusCode = resp.StatusCode

	// Explicit auth response codes
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		pi.AuthRequired = true
		return pi
	}

	// Redirect — check if destination is an auth path
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		loc := resp.Header.Get("Location")
		if loc != "" {
			pi.RedirectsTo = loc
			locURL, err := url.Parse(loc)
			if err == nil {
				abs := base.ResolveReference(locURL)
				locLower := strings.ToLower(abs.Path)
				for _, ap := range authPaths {
					if strings.HasPrefix(locLower, ap) {
						pi.AuthRequired = true
						break
					}
				}
			}
		}
		return pi
	}

	// 200 — read body for title extraction (use fetchClient which followed any
	// intermediate redirects to get the final page)
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 32*1024))
	bodyStr := string(body)

	if m := reTitleTag.FindStringSubmatch(bodyStr); len(m) > 1 {
		pi.Title = strings.TrimSpace(strings.ReplaceAll(m[1], "\n", " "))
	}

	return pi
}

// ── Framework detection ───────────────────────────────────────────────────────

func detectFramework(headers http.Header, body string) string {
	if headers != nil {
		powered := strings.ToLower(headers.Get("X-Powered-By"))
		if strings.Contains(powered, "next") {
			return "Next.js"
		}
	}
	if reNextData.MatchString(body) {
		return "Next.js"
	}
	if reNuxtData.MatchString(body) {
		return "Nuxt.js"
	}
	if reAstroMeta.MatchString(body) {
		return "Astro"
	}
	if reSvelteMeta.MatchString(body) {
		return "SvelteKit"
	}
	lowerBody := strings.ToLower(body)
	if strings.Contains(lowerBody, "gatsby-") {
		return "Gatsby"
	}
	if reVueMeta.MatchString(body) {
		return "Vue.js"
	}
	if strings.Contains(lowerBody, `id="root"`) || strings.Contains(lowerBody, `id='root'`) {
		return "React"
	}
	return ""
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

func fetchBody(client *http.Client, rawURL string) (string, http.Header) {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return "", nil
	}
	req.Header.Set("User-Agent", "OpenWatch-PageProbe/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return "", nil
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", resp.Header
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
	return string(b), resp.Header
}

// isAssetPath returns true for static file extensions and well-known asset directories.
func isAssetPath(path string) bool {
	lower := strings.ToLower(path)
	assetDirs := []string{"/_next/", "/__next/", "/static/", "/assets/", "/fonts/", "/images/", "/icons/", "/media/"}
	for _, dir := range assetDirs {
		if strings.Contains(lower, dir) {
			return true
		}
	}
	assetExts := []string{
		".js", ".mjs", ".css", ".png", ".jpg", ".jpeg", ".gif",
		".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".map",
	}
	for _, ext := range assetExts {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}
