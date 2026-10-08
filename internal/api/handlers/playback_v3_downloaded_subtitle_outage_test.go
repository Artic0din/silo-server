package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Silo-Server/silo-server/internal/playback"
	"github.com/Silo-Server/silo-server/internal/subtitles"
)

func requireDownloadedSubtitleOutageV3(t *testing.T, response playback.DecisionResponseV3) {
	t.Helper()
	if response.PlaybackPlan != nil || response.Terminal == nil {
		t.Fatalf("plan = %#v terminal = %#v, want a retryable refusal instead of a plan without the subtitle", response.PlaybackPlan, response.Terminal)
	}
	if response.Terminal.Reason != subtitleUnavailableReasonV3 || !response.Terminal.Retryable {
		t.Fatalf("terminal = %#v, want retryable %s", response.Terminal, subtitleUnavailableReasonV3)
	}
}

// A downloaded subtitle that cannot be looked up for a moment is not a
// subtitle the file lacks. A replan during the outage is refused as
// retryable, so the playing plan keeps the subtitle and the next replan
// after the store recovers still shows it. Planning it as subtitles off would
// keep it off for the rest of the session, because replans start from the
// current plan's tracks.
func TestHandleReplanPlaybackV3DownloadedSubtitleLookupOutageKeepsTheSubtitle(t *testing.T) {
	file := v3HandlerFixtureFile(t)
	repo := newMockSubtitleRepoForHandler()
	downloaded := subtitles.DownloadedSubtitle{ID: 71, MediaFileID: file.ID, Format: subtitles.FormatSRT, Language: "eng"}
	repo.list = []subtitles.DownloadedSubtitle{downloaded}
	repo.subtitles[downloaded.ID] = &downloaded

	handler := NewPlaybackHandler(playback.NewSessionManager(0, 0), testPlaybackFileResolver{file: file})
	handler.SettingsRepo = &mutablePlaybackSettingsV3{values: map[string]string{}}
	handler.ItemAccess = allowAllPlaybackItemAccess{}
	handler.SubtitleRepo = repo
	startRequest := v3HandlerStartRequest()
	downloadedIndex := len(file.ExternalSubtitles) + len(file.SubtitleTracks)
	startRequest.SubtitleTrackIndex = &downloadedIndex
	startRequest.SubtitleTrackID = playback.TrackIDV3(file.ID, "subtitle", downloadedIndex)

	rec := httptest.NewRecorder()
	handler.HandleStartPlayback(rec, httptest.NewRequest(http.MethodPost, "/api/v1/playback/start", strings.NewReader(marshalV3StartRequest(t, startRequest))).WithContext(newAuthorizedPlaybackContext()))
	var started playback.DecisionResponseV3
	if rec.Code != http.StatusCreated || json.Unmarshal(rec.Body.Bytes(), &started) != nil || started.PlaybackPlan == nil || started.PlaybackPlan.SelectedTracks.Subtitle == nil {
		t.Fatalf("start with the downloaded subtitle: status=%d body=%s", rec.Code, rec.Body.String())
	}

	replan := func(id string, current *playback.PlanV3) playback.DecisionResponseV3 {
		t.Helper()
		return postPlaybackReplanV3(t, handler, started.SessionID, playback.ReplanRequestV3{
			ProtocolVersion: playback.ProtocolV3, Operation: playback.ReplanOperationQualityChangeV3,
			PlaybackAttemptID: startRequest.PlaybackAttemptID, ReplanRequestID: "downloaded-outage-" + id,
			FailedPlanID: current.PlanID, PlanAttemptID: "downloaded-outage-attempt-" + id,
			PlanAttemptKey: current.PlanAttemptKey, AttemptCount: 1, PositionSeconds: 30,
			QualityPreference: "auto",
			// A quality change may omit the unchanged subtitle; the server
			// carries it over from the current plan.
			SelectedTracks: playback.SelectedTracksV3{Audio: current.SelectedTracks.Audio},
			Capabilities:   startRequest.Capabilities, ClientPlaybackContext: startRequest.ClientPlaybackContext,
		})
	}

	repo.listErr = errors.New("database unavailable")
	requireDownloadedSubtitleOutageV3(t, replan("0001", started.PlaybackPlan))

	repo.listErr = nil
	recovered := replan("0002", started.PlaybackPlan)
	if recovered.PlaybackPlan == nil || recovered.Terminal != nil {
		t.Fatalf("replan after the outage = %#v", recovered)
	}
	selected := recovered.PlaybackPlan.SelectedTracks.Subtitle
	if selected == nil || selected.ID != playback.TrackIDV3(file.ID, "subtitle", downloadedIndex) {
		t.Fatalf("subtitle after the outage = %#v, want the downloaded subtitle still selected", selected)
	}
}

// Starting with a downloaded subtitle during the same outage is refused as
// retryable rather than started without it. A start that selects no
// downloaded subtitle does not depend on the lookup and still plays.
func TestHandleStartPlaybackV3DownloadedSubtitleLookupOutage(t *testing.T) {
	file := v3HandlerFixtureFile(t)
	repo := newMockSubtitleRepoForHandler()
	repo.listErr = errors.New("database unavailable")
	handler := NewPlaybackHandler(playback.NewSessionManager(0, 0), testPlaybackFileResolver{file: file})
	handler.SettingsRepo = &mutablePlaybackSettingsV3{values: map[string]string{}}
	handler.ItemAccess = allowAllPlaybackItemAccess{}
	handler.SubtitleRepo = repo

	start := func(request playback.StartRequestV3) playback.DecisionResponseV3 {
		t.Helper()
		rec := httptest.NewRecorder()
		handler.HandleStartPlayback(rec, httptest.NewRequest(http.MethodPost, "/api/v1/playback/start", strings.NewReader(marshalV3StartRequest(t, request))).WithContext(newAuthorizedPlaybackContext()))
		var response playback.DecisionResponseV3
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
			t.Fatalf("start status=%d body=%s", rec.Code, rec.Body.String())
		}
		return response
	}

	withSubtitle := v3HandlerStartRequest()
	downloadedIndex := len(file.ExternalSubtitles) + len(file.SubtitleTracks)
	withSubtitle.SubtitleTrackIndex = &downloadedIndex
	withSubtitle.SubtitleTrackID = playback.TrackIDV3(file.ID, "subtitle", downloadedIndex)
	requireDownloadedSubtitleOutageV3(t, start(withSubtitle))

	withoutSubtitle := v3HandlerStartRequest()
	withoutSubtitle.PlaybackAttemptID = "attempt-handler-0002"
	if response := start(withoutSubtitle); response.PlaybackPlan == nil || response.Terminal != nil {
		t.Fatalf("start without a downloaded subtitle = %#v", response)
	}
}
