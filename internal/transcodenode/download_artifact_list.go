package transcodenode

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/Silo-Server/silo-server/internal/downloadstorage"
)

// artifactListTimeout bounds how long the listing route waits for the
// directory read. The read itself cannot be canceled (a hung network mount
// parks it), which is why only one may be outstanding at a time.
const artifactListTimeout = 15 * time.Second

// handleListDownloadArtifacts lists the files in this node's prepared-download
// directory, with the measurement they add up to, so the API can find files no
// download_artifacts row accounts for. The answer carries the directory path,
// which is why the route requires the node bearer.
func (s *Server) handleListDownloadArtifacts(w http.ResponseWriter, r *http.Request) {
	if s.artifactRoot == "" {
		http.Error(w, "artifact directory unavailable", http.StatusServiceUnavailable)
		return
	}
	if !s.artifactListInFlight.CompareAndSwap(false, true) {
		http.Error(w, "an artifact listing is already running", http.StatusServiceUnavailable)
		return
	}
	result := make(chan downloadstorage.Listing, 1)
	go func() {
		defer s.artifactListInFlight.Store(false)
		result <- downloadstorage.Inspect(s.artifactRoot, s.transcodeDir, time.Now())
	}()
	timer := time.NewTimer(artifactListTimeout)
	defer timer.Stop()
	select {
	case listing := <-result:
		if listing.Usage.Error != "" && len(listing.Files) == 0 {
			http.Error(w, "artifact directory unreadable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(listing)
	case <-timer.C:
		http.Error(w, "artifact directory did not answer in time", http.StatusServiceUnavailable)
	case <-r.Context().Done():
	}
}
