package apiv2

import (
	"os"
	"strings"
	"sync"
	"time"
)

// CollectionScheduleTimeZone is the time zone the answering node runs cron
// collection schedules in. Each node reads its own local zone, so the value
// describes only the node that answered.
type CollectionScheduleTimeZone struct {
	UTCOffset    string `json:"utc_offset" pattern:"^[+-][0-9]{2}:[0-9]{2}$" doc:"Current offset from UTC, daylight saving time included" example:"-05:00"`
	Abbreviation string `json:"abbreviation" doc:"Current zone abbreviation as the node's time zone database reports it; some zones report a numeric form such as -03" example:"CDT"`
	Name         string `json:"name,omitempty" doc:"IANA zone name; omitted unless the node's TZ environment variable names one" example:"America/Chicago"`
}

// localScheduleZoneName is read once: Go reads TZ once to set time.Local.
var localScheduleZoneName = sync.OnceValue(func() string { return ianaZoneName(os.Getenv("TZ")) })

// scheduleTimeZone reports the zone cron schedules use on this node now.
// Collection sync schedules evaluate cron with time.Now() in time.Local.
func (reg *Registry) scheduleTimeZone() CollectionScheduleTimeZone {
	if reg.deps.ScheduleZone != nil {
		return reg.deps.ScheduleZone()
	}
	return scheduleTimeZoneAt(time.Now(), localScheduleZoneName())
}

// scheduleTimeZoneAt describes now's zone, with name as the IANA name when
// one is known.
func scheduleTimeZoneAt(now time.Time, name string) CollectionScheduleTimeZone {
	abbreviation, _ := now.Zone()
	return CollectionScheduleTimeZone{UTCOffset: now.Format("-07:00"), Abbreviation: abbreviation, Name: name}
}

// ianaZoneName returns the IANA zone a TZ value names, or "" when it is unset,
// a file path, or not a zone the database knows. A leading colon is dropped,
// as Go does when it reads TZ.
func ianaZoneName(tz string) string {
	tz = strings.TrimPrefix(tz, ":")
	if tz == "" || tz == "Local" || strings.HasPrefix(tz, "/") {
		return ""
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return ""
	}
	return tz
}

// mdblistSearch reports whether the MDBList search the collection editors use
// can answer: an import service is wired and has an MDBList API key.
func (reg *Registry) mdblistSearch() bool {
	return reg.deps.CollectionImports != nil && reg.deps.CollectionImports.MDBListConfigured()
}
