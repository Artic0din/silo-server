package imagecache

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type appleTestTransport struct {
	target *url.URL
	base   http.RoundTripper
}

func (t appleTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	copy := req.Clone(req.Context())
	copy.URL.Scheme, copy.URL.Host = t.target.Scheme, t.target.Host
	return t.base.RoundTrip(copy)
}

func TestDownloadAppleImageUserAgent(t *testing.T) {
	for _, host := range []string{"is1-ssl.mzstatic.com", "is2.mzstatic.com", "images.example.com", "evil-mzstatic.com", "mzstatic.com.example.com"} {
		t.Run(host, func(t *testing.T) {
			apple := strings.HasSuffix(host, ".mzstatic.com")
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				browser := strings.HasPrefix(r.UserAgent(), "Mozilla/5.0")
				if browser != apple {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				if _, err := io.WriteString(w, "image bytes"); err != nil {
					t.Error(err)
				}
			}))
			defer server.Close()
			target, err := url.Parse(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			client := &http.Client{Transport: appleTestTransport{target, server.Client().Transport}}
			cacher := newWithHTTPClient(nil, client)
			body, err := cacher.downloadImage(context.Background(), "https://"+host+"/image/thumb/test/400x600.jpg")
			if err != nil || string(body) != "image bytes" {
				t.Fatalf("download: %q, %v", body, err)
			}
		})
	}
}
