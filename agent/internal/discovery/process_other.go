// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

//go:build !linux

package discovery

// enrichWithProcessInfo is a no-op on non-Linux platforms.
// Process correlation is only implemented for Linux via /proc.
func enrichWithProcessInfo(services []Service) {}
