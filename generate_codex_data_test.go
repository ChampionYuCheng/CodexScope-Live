package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPreferRateLimitsKeepsGlobalCodexQuota(t *testing.T) {
	global := map[string]any{
		"limit_id":  "codex",
		"plan_type": "pro",
	}
	model := map[string]any{
		"limit_id":   "codex_bengalfox",
		"limit_name": "GPT-5.3-Codex-Spark",
	}
	globalTs := time.Date(2026, 5, 9, 9, 0, 0, 0, time.UTC)
	modelTs := globalTs.Add(10 * time.Minute)

	if preferRateLimits(model, modelTs, true, global, globalTs, true) {
		t.Fatal("model-specific rate limits must not replace global codex quota")
	}
	if !preferRateLimits(global, globalTs, true, model, modelTs, true) {
		t.Fatal("global codex quota should replace model-specific rate limits")
	}
}

func TestBuildViewIncludesEndBoundary(t *testing.T) {
	start := time.Date(2026, 5, 9, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Minute)
	loaded := LoadedData{
		Events: []RuntimeEvent{
			{Ts: start, Sid: "s1", Model: "gpt-5.5", Usage: Usage{Input: 10, Total: 10}},
			{Ts: end, Sid: "s1", Model: "gpt-5.5", Usage: Usage{Input: 20, Total: 20}},
		},
	}
	view := buildView("custom", "test", start, end, loaded, map[string]map[string]string{
		"s1": {"name": "demo", "model": "gpt-5.5"},
	}, nil)
	summary := view["summary"].(map[string]any)

	if summary["requests"].(int64) != 2 {
		t.Fatalf("expected both boundary events, got %v requests", summary["requests"])
	}
	if summary["totalTokens"].(int64) != 30 {
		t.Fatalf("expected total 30, got %v", summary["totalTokens"])
	}
	if _, ok := view["trend"].([][]any); !ok {
		t.Fatalf("trend should use compact bucket rows, got %T", view["trend"])
	}
	if _, ok := view["distribution"].([][]any); !ok {
		t.Fatalf("distribution should use compact bucket rows, got %T", view["distribution"])
	}
	if view["trendStepLabel"] == "" {
		t.Fatal("compact trend should keep shared step metadata")
	}
}

func TestBuildViewAggregatesStatsInOneRangePass(t *testing.T) {
	start := time.Date(2026, 5, 9, 10, 0, 0, 0, time.UTC)
	end := start.Add(10 * time.Minute)
	loaded := LoadedData{
		Events: []RuntimeEvent{
			{Ts: start.Add(time.Minute), Sid: "s1", Model: "gpt-5.5", Usage: Usage{Input: 100, Cached: 40, Output: 20, Reasoning: 5, Total: 120}},
			{Ts: start.Add(2 * time.Minute), Sid: "s1", Model: "gpt-5.5", Usage: Usage{Input: 50, Cached: 10, Output: 10, Reasoning: 2, Total: 60}},
			{Ts: end.Add(time.Minute), Sid: "s1", Model: "gpt-5.5", Usage: Usage{Input: 999, Total: 999}},
		},
		FailureEvents: []RuntimeFailureEvent{
			{Ts: start.Add(3 * time.Minute), Sid: "s1", Model: "gpt-5.5"},
			{Ts: end.Add(time.Minute), Sid: "s1", Model: "gpt-5.5"},
		},
		TTFBEvents: []RuntimeTTFBEvent{
			{Ts: start.Add(time.Minute), Sid: "s1", Model: "gpt-5.5", TTFBMs: 500},
			{Ts: end.Add(time.Minute), Sid: "s1", Model: "gpt-5.5", TTFBMs: 9000},
		},
	}

	view := buildView("custom", "test", start, end, loaded, map[string]map[string]string{
		"s1": {"name": "demo", "model": "gpt-5.5"},
	}, nil)
	summary := view["summary"].(map[string]any)
	models := view["models"].([]map[string]any)
	sessions := view["sessions"].([]map[string]any)
	trend := view["trend"].([][]any)
	distribution := view["distribution"].([][]any)

	if summary["requests"].(int64) != 2 || summary["failures"].(int) != 1 {
		t.Fatalf("unexpected request/failure summary: %v", summary)
	}
	if summary["totalTokens"].(int64) != 180 {
		t.Fatalf("expected in-range total 180, got %v", summary["totalTokens"])
	}
	if len(models) != 1 || models[0]["latencyLabel"] != "0.50s" {
		t.Fatalf("expected in-range model latency, got %v", models)
	}
	if len(sessions) != 1 || sessions[0]["status"] != "warn" {
		t.Fatalf("expected failed session status, got %v", sessions)
	}
	var trendTotal int64
	for _, row := range trend {
		trendTotal += row[1].(int64)
	}
	if trendTotal != 180 {
		t.Fatalf("expected compact trend total 180, got %d", trendTotal)
	}
	var distributionCalls int64
	for _, row := range distribution {
		distributionCalls += row[2].(int64)
	}
	if distributionCalls != 2 {
		t.Fatalf("expected compact distribution calls 2, got %d", distributionCalls)
	}
}

func TestBuildViewClampsFailureRateAndMarksMissingQuota(t *testing.T) {
	start := time.Date(2026, 5, 9, 10, 0, 0, 0, time.UTC)
	end := start.Add(10 * time.Minute)
	loaded := LoadedData{
		Events: []RuntimeEvent{
			{Ts: start.Add(time.Minute), Sid: "s1", Model: "gpt-5.5", Usage: Usage{Input: 10, Total: 10}},
		},
		FailureEvents: []RuntimeFailureEvent{
			{Ts: start.Add(2 * time.Minute), Sid: "s1", Model: "gpt-5.5"},
			{Ts: start.Add(3 * time.Minute), Sid: "s1", Model: "gpt-5.5"},
		},
	}

	view := buildView("custom", "test", start, end, loaded, map[string]map[string]string{
		"s1": {"name": "demo", "model": "gpt-5.5"},
	}, nil)
	summary := view["summary"].(map[string]any)
	risk := view["risk"].([]map[string]any)

	if summary["failureRate"].(float64) != 100 || summary["successRate"].(float64) != 0 {
		t.Fatalf("failure/success rates should clamp to 100/0, got %v", summary)
	}
	if risk[0]["label"] != "等待数据" || risk[0]["percentLabel"] != "--" {
		t.Fatalf("missing quota should not look exhausted, got %#v", risk[0])
	}
}

func TestRuntimeRangeSlicesIncludeBoundaries(t *testing.T) {
	start := time.Date(2026, 5, 9, 10, 0, 0, 0, time.UTC)
	end := start.Add(2 * time.Minute)
	events := []RuntimeEvent{
		{Ts: start.Add(-time.Minute), Usage: Usage{Total: 1}},
		{Ts: start, Usage: Usage{Total: 2}},
		{Ts: start.Add(time.Minute), Usage: Usage{Total: 3}},
		{Ts: end, Usage: Usage{Total: 4}},
		{Ts: end.Add(time.Minute), Usage: Usage{Total: 5}},
	}
	inRange := runtimeEventsInRange(events, start, end)
	if len(inRange) != 3 || inRange[0].Usage.Total != 2 || inRange[2].Usage.Total != 4 {
		t.Fatalf("unexpected runtime event range: %#v", inRange)
	}
}

func TestOutputHasCurrentSchema(t *testing.T) {
	dir := t.TempDir()
	current := filepath.Join(dir, "current.js")
	raw := filepath.Join(dir, "current.raw.js")
	legacy := filepath.Join(dir, "legacy.js")
	if err := os.WriteFile(current, []byte(`window.CODEXSCOPE_DATA = {"schemaVersion":2,"rawDataPath":"data.raw.js","pricingRules":[],"views":{}};`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(raw, []byte(`window.CODEXSCOPE_RAW_DATA = {"schemaVersion":2,"rawSchemaVersion":1,"catalog":{},"recordBase":1,"recordsV2":[]};`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte(`window.CODEXSCOPE_DATA = {"records":[]};`), 0o644); err != nil {
		t.Fatal(err)
	}
	if !outputHasCurrentSchema(current) {
		t.Fatal("current schema should be accepted")
	}
	if !outputHasCurrentSchemaForRawPath(current, "data.raw.js") {
		t.Fatal("current schema should be accepted when rawDataPath matches")
	}
	if outputHasCurrentSchemaForRawPath(current, "other.raw.js") {
		t.Fatal("schema should not be fresh when rawDataPath points at another sidecar")
	}
	if !rawOutputHasCurrentSchema(raw) {
		t.Fatal("current raw schema should be accepted")
	}
	if outputHasCurrentSchema(legacy) {
		t.Fatal("legacy schema should not be treated as fresh")
	}
	if rawOutputHasCurrentSchema(legacy) {
		t.Fatal("legacy raw schema should not be treated as fresh")
	}
}

func TestRawOutputSchemaCheckOnlyNeedsHeaderMarker(t *testing.T) {
	dir := t.TempDir()
	raw := filepath.Join(dir, "large.raw.js")
	body := `window.CODEXSCOPE_RAW_DATA = {"schemaVersion":2,"rawSchemaVersion":1,"catalog":{},` + strings.Repeat(`"x",`, 100000) + `"recordsV2":[]};`
	if err := os.WriteFile(raw, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if !rawOutputHasCurrentSchema(raw) {
		t.Fatal("raw schema marker in the file head should be accepted without scanning the full raw export")
	}
}

func TestPrepareMainPayloadForExportDropsRawAndDuplicateFields(t *testing.T) {
	payload := map[string]any{
		"schemaVersion":    2,
		"pricingRules":     pricingRulesPayload(),
		"catalog":          map[string]any{"sessions": [][]any{{"s1", "demo", "gpt-test"}}, "models": []string{"gpt-test"}},
		"recordBase":       int64(1),
		"recordsV2":        [][]any{{1, 0, 0, 10, 0, 0, 0, 10}},
		"ttfbRecordsV2":    [][]any{{1, 0, 0, 100}},
		"failureRecordsV2": [][]any{{1, 0, 0}},
		"summary":          map[string]any{"totalTokensLabel": "10"},
		"trend":            []map[string]any{{"time": "00:00"}},
		"sessions":         []map[string]any{{"name": "demo"}},
		"models":           []map[string]any{{"name": "gpt-test"}},
		"risk":             []map[string]any{{"name": "5h"}},
		"coverage":         []map[string]any{{"metric": "Token"}},
		"views":            map[string]any{},
	}

	raw := buildRawPayload(payload)
	prepareMainPayloadForExport(payload, filepath.Join("public", "data.js"), filepath.Join("nested", "data.raw.js"))

	for _, key := range []string{"catalog", "recordBase", "recordsV2", "ttfbRecordsV2", "failureRecordsV2", "summary", "trend", "sessions", "models", "risk", "coverage"} {
		if _, ok := payload[key]; ok {
			t.Fatalf("%s should not be exported in the main payload", key)
		}
	}
	if payload["rawDataPath"] != "../nested/data.raw.js" {
		t.Fatalf("rawDataPath should be relative to data.js, got %v", payload["rawDataPath"])
	}
	if rules, ok := payload["pricingRules"].([]PricingRuleExport); !ok || len(rules) == 0 {
		t.Fatalf("main payload should keep exported pricing rules, got %T", payload["pricingRules"])
	}
	if raw.Catalog == nil || raw.RecordsV2 == nil || raw.RecordBase == nil || raw.RawSchemaVersion != 1 {
		t.Fatal("raw payload should keep compact event rows")
	}
}

func TestPricingRulesPayloadFeedsRuntimePricing(t *testing.T) {
	rules := pricingRulesPayload()
	if len(rules) != len(modelPricingUSDPerM) {
		t.Fatalf("expected %d exported pricing rules, got %d", len(modelPricingUSDPerM), len(rules))
	}
	if rules[0].Label == "" || len(rules[0].Patterns) == 0 {
		t.Fatalf("pricing rules should include display labels and match patterns: %#v", rules[0])
	}
	rules[0].Patterns[0] = "mutated"
	if modelPricingUSDPerM[0].patterns[0] == "mutated" {
		t.Fatal("pricing export must not alias the runtime matching table")
	}
	if pricingForModel("gpt-5.4-mini") == nil {
		t.Fatal("runtime pricing should still match generated model names")
	}
}

func TestWriteJSPayloadCreatesParentDirectory(t *testing.T) {
	out := filepath.Join(t.TempDir(), "nested", "data.js")
	if err := writeJSPayload(out, "CODEXSCOPE_DATA", map[string]any{"schemaVersion": 2}); err != nil {
		t.Fatalf("writeJSPayload should create parent directories: %v", err)
	}
	body, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "window.CODEXSCOPE_DATA") || !strings.Contains(string(body), "window.QUOTASCOPE_DATA") {
		t.Fatalf("unexpected JS payload content: %s", body)
	}
}

func TestBrowserRelativePathUsesForwardSlashes(t *testing.T) {
	got := browserRelativePath(filepath.Join("release", "app"), filepath.Join("release", "raw", "data.raw.js"))
	if got != "../raw/data.raw.js" {
		t.Fatalf("unexpected browser relative path: %s", got)
	}
}

func TestLoadedDataBoundsIncludesFailureOnlyEvents(t *testing.T) {
	fallback := time.Date(2026, 5, 9, 10, 0, 0, 0, time.UTC)
	failureTs := fallback.Add(-2 * time.Hour)
	start, end, ok := loadedDataBounds(LoadedData{
		FailureEvents: []RuntimeFailureEvent{{Ts: failureTs, Sid: "s1", Model: "gpt-5.5"}},
	}, fallback)
	if !ok || !start.Equal(failureTs) || !end.Equal(failureTs) {
		t.Fatalf("failure-only bounds should be visible, got start=%s end=%s ok=%v", start, end, ok)
	}
}

func TestBuildPayloadOmitsLegacyDuplicateViews(t *testing.T) {
	payload := buildPayload(t.TempDir(), 0, "", nil)
	for _, key := range []string{"summary", "trend", "sessions", "models", "risk", "coverage"} {
		if _, ok := payload[key]; ok {
			t.Fatalf("%s should be supplied by precomputed views, not duplicated at top level", key)
		}
	}
	if views, ok := payload["views"].(map[string]any); !ok || len(views) == 0 {
		t.Fatalf("payload should keep precomputed views, got %T", payload["views"])
	}
}

func TestOutputIsFreshRejectsOutputsOlderThanGeneratorSources(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "data.js")
	rawOut := filepath.Join(dir, "data.raw.js")
	if err := os.WriteFile(out, []byte(`window.CODEXSCOPE_DATA = {"schemaVersion":2,"rawDataPath":"data.raw.js","pricingRules":[],"views":{}};`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rawOut, []byte(`window.CODEXSCOPE_RAW_DATA = {"schemaVersion":2,"rawSchemaVersion":1,"catalog":{},"recordBase":1,"recordsV2":[]};`), 0o644); err != nil {
		t.Fatal(err)
	}
	old := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := os.Chtimes(out, old, old); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(rawOut, old, old); err != nil {
		t.Fatal(err)
	}
	files := []sessionFileCandidate{{path: filepath.Join(dir, "session.jsonl"), mtimeNs: old.UnixNano(), size: 1}}
	cacheFiles := map[string]FileCache{
		files[0].path: {MtimeNs: files[0].mtimeNs, Size: files[0].size},
	}
	if outputIsFresh(out, rawOut, files, cacheFiles) {
		t.Fatal("outputs older than generator sources should not be treated as fresh")
	}
}

func TestPayloadLogSummaryPrefersHistoryTotals(t *testing.T) {
	payload := map[string]any{
		"views": map[string]any{
			"today":   map[string]any{"summary": map[string]any{"requestsLabel": "1", "totalTokensLabel": "10"}},
			"history": map[string]any{"summary": map[string]any{"requestsLabel": "9", "totalTokensLabel": "90"}},
		},
	}
	summary := payloadLogSummary(payload)
	if summary["requestsLabel"] != "9" || summary["totalTokensLabel"] != "90" {
		t.Fatalf("expected history totals for CLI log, got %v", summary)
	}
}

func TestPreferRateLimitsUsesNewestWithinSameQuotaClass(t *testing.T) {
	older := map[string]any{
		"limit_id": "codex",
	}
	newer := map[string]any{
		"limit_id": "codex",
	}
	olderTs := time.Date(2026, 5, 9, 9, 0, 0, 0, time.UTC)
	newerTs := olderTs.Add(10 * time.Minute)

	if !preferRateLimits(newer, newerTs, true, older, olderTs, true) {
		t.Fatal("newer global quota should replace older global quota")
	}
	if preferRateLimits(older, olderTs, true, newer, newerTs, true) {
		t.Fatal("older global quota should not replace newer global quota")
	}
}

func TestCutoffForDaysSupportsAllHistory(t *testing.T) {
	now := time.Date(2026, 5, 9, 10, 0, 0, 0, time.UTC)

	if cutoff := cutoffForDays(0, now); !cutoff.IsZero() {
		t.Fatalf("all-history cutoff should be zero time, got %s", cutoff)
	}
	if cutoff := cutoffForDays(30, now); !cutoff.Equal(now.Add(-30 * 24 * time.Hour)) {
		t.Fatalf("30-day cutoff mismatch: %s", cutoff)
	}
}

func TestCacheCoversDaysHandlesAllHistory(t *testing.T) {
	if !cacheCoversDays(0, 30) {
		t.Fatal("all-history cache should cover a shorter requested window")
	}
	if cacheCoversDays(30, 0) {
		t.Fatal("30-day cache must not satisfy an all-history request")
	}
	if !cacheCoversDays(30, 7) {
		t.Fatal("30-day cache should cover a 7-day request")
	}
}

func TestMergeSessionFileDeduplicatesRepeatedSnapshots(t *testing.T) {
	tsA := "2026-05-09T10:00:00Z"
	tsB := "2026-05-09T10:00:01Z"
	snapshot := Usage{Input: 1000, Cached: 800, Output: 50, Reasoning: 10, Total: 1050}
	event := UsageEvent{
		Ts:          tsA,
		Sid:         "session-1",
		Model:       "gpt-test",
		Usage:       Usage{Input: 1000, Cached: 800, Output: 50, Reasoning: 10, Total: 1050},
		Snapshot:    snapshot,
		HasSnapshot: true,
	}
	duplicate := event
	duplicate.Ts = tsB

	loaded := LoadedData{}
	var latestLimitsTs time.Time
	seen := map[string]struct{}{}
	mergeSessionFile(ParsedFile{Sid: "session-1", Model: "gpt-test", UsageEvents: []UsageEvent{event}}, time.Time{}, &loaded, &latestLimitsTs, seen)
	mergeSessionFile(ParsedFile{Sid: "session-1", Model: "gpt-test", UsageEvents: []UsageEvent{duplicate}}, time.Time{}, &loaded, &latestLimitsTs, seen)

	if len(loaded.Events) != 1 {
		t.Fatalf("expected 1 deduplicated usage event, got %d", len(loaded.Events))
	}
	if len(loaded.Sessions) != 1 {
		t.Fatalf("expected duplicate session file to be skipped, got %d session rows", len(loaded.Sessions))
	}
	if loaded.Sessions[0].Calls != 1 || loaded.Sessions[0].Usage.Total != 1050 {
		t.Fatalf("unexpected session totals: calls=%d total=%d", loaded.Sessions[0].Calls, loaded.Sessions[0].Usage.Total)
	}
}

func TestParseSessionFileKeepsTurnMetadataForUsageAndCompletion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mixed.jsonl")
	fixture := strings.Join([]string{
		`{"type":"session_meta","payload":{"id":"sid-mixed"}}`,
		`{"type":"turn_context","payload":{"turn_id":"turn-sol","model":"gpt-5.6-sol","effort":"high"}}`,
		`{"timestamp":"2026-05-09T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":3,"reasoning_output_tokens":1,"total_tokens":14}}}}`,
		`{"timestamp":"2026-05-09T10:00:01Z","payload":{"type":"task_complete","duration_ms":1200,"time_to_first_token_ms":300}}`,
		`{"type":"turn_context","payload":{"turn_id":"turn-terra","model":"gpt-5.6-terra","effort":"low"}}`,
		`{"timestamp":"2026-05-09T10:01:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":20,"cached_input_tokens":4,"output_tokens":5,"reasoning_output_tokens":2,"total_tokens":27}}}}`,
		`{"timestamp":"2026-05-09T10:01:01Z","payload":{"type":"task_complete","duration_ms":2200,"time_to_first_token_ms":500}}`,
	}, "\n") + "\n"
	if err := os.WriteFile(path, []byte(fixture), 0o644); err != nil {
		t.Fatal(err)
	}

	parsed := parseSessionFile(path, time.Time{})
	if len(parsed.UsageEvents) != 2 || parsed.UsageEvents[0].TurnID != "turn-sol" || parsed.UsageEvents[1].TurnID != "turn-terra" {
		t.Fatalf("usage events should preserve turn ids, got %#v", parsed.UsageEvents)
	}
	if parsed.UsageEvents[0].Effort != "high" || parsed.UsageEvents[1].Effort != "low" {
		t.Fatalf("usage events should preserve effort, got %#v", parsed.UsageEvents)
	}
	if len(parsed.CompletionEvents) != 2 || parsed.CompletionEvents[0].TurnID != "turn-sol" || parsed.CompletionEvents[1].TurnID != "turn-terra" {
		t.Fatalf("completion events should preserve turn ids, got %#v", parsed.CompletionEvents)
	}
	if parsed.CompletionEvents[0].Effort != "high" || parsed.CompletionEvents[1].Effort != "low" {
		t.Fatalf("completion events should preserve effort, got %#v", parsed.CompletionEvents)
	}
}

func TestParseSessionFileClearsMissingEffortOnNewTurn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing-effort.jsonl")
	fixture := strings.Join([]string{
		`{"type":"session_meta","payload":{"id":"sid-missing-effort"}}`,
		`{"type":"turn_context","payload":{"turn_id":"turn-high","model":"gpt-5.6-sol","effort":"high"}}`,
		`{"timestamp":"2026-05-09T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":10}}}}`,
		`{"type":"turn_context","payload":{"turn_id":"turn-unspecified","model":"gpt-5.6-terra"}}`,
		`{"timestamp":"2026-05-09T10:01:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":20}}}}`,
		`{"timestamp":"2026-05-09T10:01:01Z","payload":{"type":"task_complete","duration_ms":200,"time_to_first_token_ms":50}}`,
	}, "\n") + "\n"
	if err := os.WriteFile(path, []byte(fixture), 0o644); err != nil {
		t.Fatal(err)
	}

	parsed := parseSessionFile(path, time.Time{})
	if len(parsed.UsageEvents) != 2 {
		t.Fatalf("expected two usage events, got %#v", parsed.UsageEvents)
	}
	if parsed.UsageEvents[0].Effort != "high" {
		t.Fatalf("first turn should keep explicit effort, got %#v", parsed.UsageEvents[0])
	}
	if parsed.UsageEvents[1].TurnID != "turn-unspecified" || parsed.UsageEvents[1].Model != "gpt-5.6-terra" || parsed.UsageEvents[1].Effort != "" {
		t.Fatalf("new turn without effort must not inherit the previous turn, got %#v", parsed.UsageEvents[1])
	}
	if len(parsed.CompletionEvents) != 1 || parsed.CompletionEvents[0].Effort != "" {
		t.Fatalf("completion without explicit effort must stay unspecified, got %#v", parsed.CompletionEvents)
	}
}

func TestBuildViewSeparatesMixedModelAndEffortSession(t *testing.T) {
	start := time.Date(2026, 5, 9, 10, 0, 0, 0, time.UTC)
	end := start.Add(10 * time.Minute)
	loaded := LoadedData{
		Events: []RuntimeEvent{
			{Ts: start.Add(time.Minute), Sid: "sid-mixed", Model: "gpt-5.6-sol", Effort: "high", TurnID: "turn-sol", Usage: Usage{Total: 10}},
			{Ts: start.Add(2 * time.Minute), Sid: "sid-mixed", Model: "gpt-5.6-terra", Effort: "low", TurnID: "turn-terra", Usage: Usage{Total: 30}},
		},
		CompletionEvents: []RuntimeCompletionEvent{
			{Ts: start.Add(time.Minute), Sid: "sid-mixed", Model: "gpt-5.6-sol", Effort: "high", TurnID: "turn-sol", DurationMs: 1200, TTFBMs: 300},
			{Ts: start.Add(2 * time.Minute), Sid: "sid-mixed", Model: "gpt-5.6-terra", Effort: "low", TurnID: "turn-terra", DurationMs: 2200, TTFBMs: 500},
		},
	}

	view := buildView("custom", "test", start, end, loaded, map[string]map[string]string{
		"sid-mixed": {"name": "mixed", "model": "gpt-5.6-sol"},
	}, nil)
	sessions := view["sessions"].([]map[string]any)
	if len(sessions) != 1 {
		t.Fatalf("expected one mixed session, got %#v", sessions)
	}
	session := sessions[0]
	if session["id"] != "sid-mixed" {
		t.Fatalf("session view must expose a stable local id for refresh-safe interaction state, got %#v", session)
	}
	if session["latestModel"] != "gpt-5.6-terra" || session["model"] != "gpt-5.6-terra" {
		t.Fatalf("session should show latest usage model, got %#v", session)
	}
	if len(session["modelBreakdown"].([]map[string]any)) != 2 || len(session["effortBreakdown"].([]map[string]any)) != 2 {
		t.Fatalf("session should expose model and effort breakdowns, got %#v", session)
	}
	if session["ttfbMedianMs"] != int64(400) || session["ttfbP90Ms"] != int64(500) || session["durationMedianMs"] != int64(1700) || session["durationP90Ms"] != int64(2200) {
		t.Fatalf("session latency percentiles should be exact, got %#v", session)
	}
}

func TestLoadCacheRejectsPreviousSchemaVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cache.json")
	body := `{"version":` + fmt.Sprint(cacheVersion-1) + `,"windowDays":30,"files":{}}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := loadCache(path, 30); got != nil {
		t.Fatalf("cache from previous schema version must be invalidated, got %#v", got)
	}
}

func TestParseSessionFileAppendKeepsCurrentTurnMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "append.jsonl")
	prefix := strings.Join([]string{
		`{"type":"session_meta","payload":{"id":"sid-append"}}`,
		`{"type":"turn_context","payload":{"turn_id":"turn-sol","model":"gpt-5.6-sol","effort":"high"}}`,
		`{"timestamp":"2026-05-09T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":10}}}}`,
	}, "\n") + "\n"
	if err := os.WriteFile(path, []byte(prefix), 0o644); err != nil {
		t.Fatal(err)
	}
	cached := parseSessionFile(path, time.Time{})
	offset := int64(len(prefix))
	suffix := strings.Join([]string{
		`{"timestamp":"2026-05-09T10:01:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":20}}}}`,
		`{"timestamp":"2026-05-09T10:01:01Z","payload":{"type":"task_complete","duration_ms":200,"time_to_first_token_ms":50}}`,
	}, "\n") + "\n"
	if err := os.WriteFile(path, append([]byte(prefix), []byte(suffix)...), 0o644); err != nil {
		t.Fatal(err)
	}
	parsed := parseSessionFileAppend(path, time.Time{}, cached, offset)
	if len(parsed.UsageEvents) != 2 || parsed.UsageEvents[1].Model != "gpt-5.6-sol" || parsed.UsageEvents[1].Effort != "high" || parsed.UsageEvents[1].TurnID != "turn-sol" {
		t.Fatalf("append parse should retain current turn metadata, got %#v", parsed.UsageEvents)
	}
	if len(parsed.CompletionEvents) != 1 || parsed.CompletionEvents[0].Effort != "high" {
		t.Fatalf("append completion should retain current turn metadata, got %#v", parsed.CompletionEvents)
	}
}

func TestBuildPayloadAppendsMetadataWithoutMovingLegacyRecordFields(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "session.jsonl")
	fixture := strings.Join([]string{
		`{"type":"session_meta","payload":{"id":"sid-layout"}}`,
		`{"type":"turn_context","payload":{"turn_id":"turn-layout","model":"gpt-test","effort":"medium"}}`,
		`{"timestamp":"2026-05-09T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1,"cached_input_tokens":2,"output_tokens":3,"reasoning_output_tokens":4,"total_tokens":5}}}}`,
	}, "\n") + "\n"
	if err := os.WriteFile(path, []byte(fixture), 0o644); err != nil {
		t.Fatal(err)
	}
	payload := buildPayload(root, 0, "", nil)
	records := payload["recordsV2"].([][]any)
	if len(records) != 1 || len(records[0]) != 10 {
		t.Fatalf("usage records should keep 8 legacy fields and append 2 metadata fields, got %#v", records)
	}
	for index, want := range []any{int64(1), int64(2), int64(3), int64(4), int64(5)} {
		if records[0][index+3] != want {
			t.Fatalf("legacy usage field %d moved or changed: got %#v", index+3, records[0])
		}
	}
	if _, ok := payload["turnCatalog"]; ok {
		t.Fatal("turn catalog belongs under catalog to preserve the public top-level contract")
	}
	catalog := payload["catalog"].(map[string]any)
	if len(catalog["turns"].([]string)) != 1 || len(catalog["efforts"].([]string)) != 1 {
		t.Fatalf("metadata catalogs should be compact and present, got %#v", catalog)
	}
}

func TestBuildPayloadExportsCompletionRecordsForCustomRanges(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "mixed-completions.jsonl")
	fixture := strings.Join([]string{
		"{\"type\":\"session_meta\",\"payload\":{\"id\":\"sid-completions\"}}",
		"{\"type\":\"turn_context\",\"payload\":{\"turn_id\":\"turn-sol\",\"model\":\"gpt-5.6-sol\",\"effort\":\"high\"}}",
		"{\"timestamp\":\"2026-05-09T10:00:00Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"last_token_usage\":{\"total_tokens\":10}}}}",
		"{\"timestamp\":\"2026-05-09T10:00:01Z\",\"payload\":{\"type\":\"task_complete\",\"duration_ms\":1200,\"time_to_first_token_ms\":300}}",
		"{\"type\":\"turn_context\",\"payload\":{\"turn_id\":\"turn-terra\",\"model\":\"gpt-5.6-terra\",\"effort\":\"low\"}}",
		"{\"timestamp\":\"2026-05-09T10:01:00Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"last_token_usage\":{\"total_tokens\":20}}}}",
		"{\"timestamp\":\"2026-05-09T10:01:01Z\",\"payload\":{\"type\":\"task_complete\",\"duration_ms\":2200,\"time_to_first_token_ms\":500}}",
	}, "\n") + "\n"
	if err := os.WriteFile(path, []byte(fixture), 0o644); err != nil {
		t.Fatal(err)
	}

	payload := buildPayload(root, 0, "", nil)
	records := payload["recordsV2"].([][]any)
	if len(records) != 2 || len(records[0]) != 10 {
		t.Fatalf("usage records must keep legacy fields and append metadata, got %#v", records)
	}
	completions, ok := payload["completionRecordsV2"].([][]any)
	if !ok || len(completions) != 2 || len(completions[0]) != 7 {
		t.Fatalf("completion records must use the compact seven-field layout, got %#v", payload["completionRecordsV2"])
	}
	catalog := payload["catalog"].(map[string]any)
	models := catalog["models"].([]string)
	turns := catalog["turns"].([]string)
	efforts := catalog["efforts"].([]string)
	first := completions[0]
	second := completions[1]
	if models[first[2].(int)] != "gpt-5.6-sol" || turns[first[5].(int)] != "turn-sol" || efforts[first[6].(int)] != "high" {
		t.Fatalf("first completion metadata cannot be decoded, got %#v with %#v", first, catalog)
	}
	if first[3] != int64(1200) || first[4] != int64(300) {
		t.Fatalf("first completion latency changed, got %#v", first)
	}
	if models[second[2].(int)] != "gpt-5.6-terra" || turns[second[5].(int)] != "turn-terra" || efforts[second[6].(int)] != "low" {
		t.Fatalf("second completion metadata cannot be decoded, got %#v with %#v", second, catalog)
	}
	if second[3] != int64(2200) || second[4] != int64(500) {
		t.Fatalf("second completion latency changed, got %#v", second)
	}
}
