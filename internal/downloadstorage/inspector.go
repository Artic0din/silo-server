package downloadstorage

import (
	"context"
	"errors"
	"sync/atomic"
	"time"
)

// ErrInspectBusy reports that an earlier read of the directory is still
// running, which on a hung network mount can be indefinitely.
var ErrInspectBusy = errors.New("a directory read is already running")

// ErrInspectTimeout reports that the directory did not answer in time.
var ErrInspectTimeout = errors.New("the directory did not answer in time")

// Inspector runs Inspect with a time limit, one read at a time. The read
// itself cannot be canceled (a hung network mount parks it), which is why only
// one may be outstanding: a call while one still runs fails at once instead
// of starting another. The zero value is ready to use.
type Inspector struct {
	inFlight atomic.Bool
	// read replaces Inspect in tests.
	read func(dir, scratchDir string, now time.Time) Listing
}

// Inspect lists dir as Inspect does, giving up after limit or when ctx ends.
// A read that gives up keeps running in the background until the directory
// answers, and the next call fails with ErrInspectBusy until then.
func (in *Inspector) Inspect(ctx context.Context, dir, scratchDir string, limit time.Duration) (Listing, error) {
	if !in.inFlight.CompareAndSwap(false, true) {
		return Listing{}, ErrInspectBusy
	}
	read := in.read
	if read == nil {
		read = Inspect
	}
	result := make(chan Listing, 1)
	go func() {
		defer in.inFlight.Store(false)
		result <- read(dir, scratchDir, time.Now())
	}()
	timer := time.NewTimer(limit)
	defer timer.Stop()
	select {
	case listing := <-result:
		return listing, nil
	case <-timer.C:
		return Listing{}, ErrInspectTimeout
	case <-ctx.Done():
		return Listing{}, ctx.Err()
	}
}
