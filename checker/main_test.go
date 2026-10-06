package main

import (
	"net/netip"
	"testing"
	"time"
)

func TestNormalizeHost(t *testing.T) {
	ok := map[string]string{
		"Example.com":                    "example.com",
		"https://www.example.com/a?b=c":  "www.example.com",
		"example.com:443":                "example.com",
		"http://user@example.co.uk/":     "example.co.uk",
		"xn--bcher-kva.example":          "xn--bcher-kva.example",
		"sha3.si.":                       "sha3.si",
	}
	for in, want := range ok {
		got, err := normalizeHost(in)
		if err != nil || got != want {
			t.Errorf("normalizeHost(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	bad := []string{"", "localhost", "example.com:8443", "10.0.0.1", "[::1]", "printer.local",
		"db.internal", "exa mple.com", "-bad.com", "a", "1.2.3", "foo.lan"}
	for _, in := range bad {
		if got, err := normalizeHost(in); err == nil {
			t.Errorf("normalizeHost(%q) = %q, want an error", in, got)
		}
	}
}

func TestIsPublic(t *testing.T) {
	pub := []string{"1.1.1.1", "185.199.108.153", "2606:4700:4700::1111", "64:ff9b::808:808", "::ffff:8.8.8.8"}
	priv := []string{"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1",
		"0.0.0.0", "::1", "fc00::1", "fe80::1", "64:ff9b::a00:1", "::ffff:127.0.0.1", "198.18.0.1", "224.0.0.1"}
	for _, s := range pub {
		if !isPublic(netip.MustParseAddr(s)) {
			t.Errorf("%s should be public", s)
		}
	}
	for _, s := range priv {
		if isPublic(netip.MustParseAddr(s)) {
			t.Errorf("%s should be blocked", s)
		}
	}
}

func TestLimiter(t *testing.T) {
	l := &limiter{hits: map[string][]time.Time{}}
	for i := 0; i < ratePerMinute; i++ {
		if !l.allow("a") {
			t.Fatalf("hit %d refused", i)
		}
	}
	if l.allow("a") {
		t.Fatal("limit not enforced")
	}
	if !l.allow("b") {
		t.Fatal("other client blocked")
	}
}
