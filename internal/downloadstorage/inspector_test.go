package downloadstorage

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A read parked on a hung mount times out, and until it returns no second
// read starts.
func TestInspectorBoundsAndSerializesReads(t *testing.T) {
	release := make(chan struct{})
	in := &Inspector{read: func(dir, _ string, now time.Time) Listing {
		<-release
		return Listing{Usage: Usage{Dir: dir, MeasuredAt: now}}
	}}
	if _, err := in.Inspect(context.Background(), "/hung", "", 10*time.Millisecond); !errors.Is(err, ErrInspectTimeout) {
		t.Fatalf("hung read = %v, want ErrInspectTimeout", err)
	}
	if _, err := in.Inspect(context.Background(), "/hung", "", time.Second); !errors.Is(err, ErrInspectBusy) {
		t.Fatalf("second read while the first is parked = %v, want ErrInspectBusy", err)
	}
	close(release)
	deadline := time.Now().Add(5 * time.Second)
	for {
		listing, err := in.Inspect(context.Background(), "/back", "", time.Second)
		if err == nil {
			if listing.Usage.Dir != "/back" {
				t.Fatalf("listing = %+v", listing)
			}
			return
		}
		if !errors.Is(err, ErrInspectBusy) || time.Now().After(deadline) {
			t.Fatalf("read after the mount answered = %v", err)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// A completed read frees the slot before the caller sees its answer, so the
// next call starts a new read.
func TestInspectorFreesTheSlotBeforeAnswering(t *testing.T) {
	in := &Inspector{read: func(dir, _ string, now time.Time) Listing {
		return Listing{Usage: Usage{Dir: dir, MeasuredAt: now}}
	}}
	for i := range 100 {
		if _, err := in.Inspect(context.Background(), "/dir", "", time.Second); err != nil {
			t.Fatalf("read %d = %v", i, err)
		}
	}
}
