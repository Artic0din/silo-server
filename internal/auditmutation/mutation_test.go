package auditmutation

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Silo-Server/silo-server/internal/models"
)

func TestUserChangeDetailsNeverIncludePasswordHash(t *testing.T) {
	before := &models.User{ID: 2, Permissions: []string{"marker_edit"}, PasswordHash: "secret-canary"}
	after := &models.User{ID: 2, Permissions: []string{}, PasswordHash: "new-secret-canary", Enabled: true}
	changes := Changes(UserValues(before), UserValues(after))
	raw, _ := json.Marshal(changes)
	if strings.Contains(string(raw), "canary") {
		t.Fatal("secret in audit")
	}
	if len(changes) != 2 || changes[1].Field != "permissions" || *changes[1].Before != `["marker_edit"]` || *changes[1].After != `[]` {
		t.Fatalf("changes: %s", raw)
	}
}
