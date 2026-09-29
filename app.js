(() => {
    let data = window.CODEXSCOPE_DATA || window.QUOTASCOPE_DATA || window.CODEXSCOPE_SAMPLE_DATA;
    if (!data)
        return;
    const uiState = {
        activeTab: "overview",
        sessionsExpanded: false,
        expandedSessionKey: "",
        modelsExpanded: false,
        sessionMode: "tokens",
        distributionMode: "calls",
        currency: "USD",
        sessionQuery: "",
        modelQuery: "",
        trendMode: "cumulative",
        trendScale: "linear",
        chartKinds: {
            trend: "line",
            requests: "line",
            "peak-rate": "line",
            "cache-hit": "line",
            distribution: "bar",
            cost: "bar",
        },
        trendSeries: {
            total: true,
            cached: true,
            output: true,
            input: true,
            reasoning: true,
        },
        chartInteractions: {},
    };
    const collapsedSessionLimit = 8;
    const collapsedModelLimit = 6;
    let legacySessionRenderEpoch = 0;
    const $ = (id) => document.getElementById(id);
    const clampPercent = (value) => Math.max(0, Math.min(100, Number(value) || 0));
    const pct = (value) => `${clampPercent(value).toFixed(0)}%`;
    const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[ch]);
    const setText = (id, value) => {
        const el = $(id);
        if (el)
            el.textContent = value;
    };
    const DAY = 24 * 60 * 60 * 1000;
    const HOUR = 60 * 60 * 1000;
    const MINUTE = 60 * 1000;
    const RATE_WINDOW_MS = 60 * 1000;
    const recordTime = (row) => Number(row?.[0]) || 0;
    const isSortedByTime = (rows) => {
        for (let i = 1; i < rows.length; i += 1) {
            if (recordTime(rows[i - 1]) > recordTime(rows[i]))
                return false;
        }
        return true;
    };
    const sortByTime = (rows) => {
        if (!Array.isArray(rows))
            return [];
        if (rows.length < 2 || isSortedByTime(rows))
            return rows;
        return [...rows].sort((a, b) => recordTime(a) - recordTime(b));
    };
    let rawDataPath = data.rawDataPath || "data.raw.js";
    const getRawData = () => window.CODEXSCOPE_RAW_DATA || data;
    const getCatalog = (source = getRawData()) => source.catalog || data.catalog || {};
    const getSessionCatalogRows = (source = getRawData()) => {
        const catalog = getCatalog(source);
        return Array.isArray(catalog.sessions) ? catalog.sessions : [];
    };
    const getModelCatalogRows = (source = getRawData()) => {
        const catalog = getCatalog(source);
        return Array.isArray(catalog.models) ? catalog.models : [];
    };
    const getTurnCatalogRows = (source = getRawData()) => {
        const catalog = getCatalog(source);
        return Array.isArray(catalog.turns) ? catalog.turns : [];
    };
    const getEffortCatalogRows = (source = getRawData()) => {
        const catalog = getCatalog(source);
        return Array.isArray(catalog.efforts) ? catalog.efforts : [];
    };
    let sessionsCatalogCache = null;
    let sessionsCatalogRowsCache = null;
    const getSessionsCatalog = () => {
        if (data.sessionsCatalog)
            return data.sessionsCatalog;
        const rows = getSessionCatalogRows();
        if (sessionsCatalogCache && sessionsCatalogRowsCache === rows)
            return sessionsCatalogCache;
        sessionsCatalogRowsCache = rows;
        sessionsCatalogCache = rows.reduce((acc, row) => {
            const sid = String(row?.[0] || "");
            if (sid)
                acc[sid] = { name: row?.[1] || `会话 ${sid.slice(-6)}`, model: row?.[2] || "unknown" };
            return acc;
        }, {});
        return sessionsCatalogCache;
    };
    const rawDataset = (source = getRawData()) => {
        const sessions = getSessionCatalogRows(source);
        const models = getModelCatalogRows(source);
        const turns = getTurnCatalogRows(source);
        const efforts = getEffortCatalogRows(source);
        const recordBase = Number(source.recordBase) || 0;
        return {
            ts: (value) => recordBase ? recordBase + (Number(value) || 0) : Number(value) || 0,
            sidAt: (index) => sessions[Number(index)]?.[0] || "unknown",
            modelAt: (index) => models[Number(index)] || "unknown",
            turnAt: (index) => turns[Number(index)] || "unknown",
            effortAt: (index) => efforts[Number(index)] || "unknown",
        };
    };
    const sourceWithRows = (field) => Array.isArray(data[field]) ? data : getRawData();
    const decodeUsageRowsV2 = (rows, source) => {
        const dataset = rawDataset(source);
        return rows.map((row) => [
            dataset.ts(row?.[0]),
            dataset.sidAt(row?.[1]),
            dataset.modelAt(row?.[2]),
            row?.[3] || 0,
            row?.[4] || 0,
            row?.[5] || 0,
            row?.[6] || 0,
            row?.[7] || 0,
            dataset.turnAt(row?.[8]),
            dataset.effortAt(row?.[9]),
        ]);
    };
    const decodeCompletionRowsV2 = (rows, source) => {
        const dataset = rawDataset(source);
        return rows.map((row) => [
            dataset.ts(row?.[0]),
            dataset.sidAt(row?.[1]),
            dataset.modelAt(row?.[2]),
            row?.[3] || 0,
            row?.[4] || 0,
            dataset.turnAt(row?.[5]),
            dataset.effortAt(row?.[6]),
        ]);
    };
    const decodeTtfbRowsV2 = (rows, source) => {
        const dataset = rawDataset(source);
        return rows.map((row) => [
            dataset.ts(row?.[0]),
            dataset.sidAt(row?.[1]),
            dataset.modelAt(row?.[2]),
            row?.[3] || 0,
        ]);
    };
    const decodeFailureRowsV2 = (rows, source) => {
        const dataset = rawDataset(source);
        return rows.map((row) => [
            dataset.ts(row?.[0]),
            dataset.sidAt(row?.[1]),
            dataset.modelAt(row?.[2]),
        ]);
    };
    const decodeRecords = () => {
        const source = sourceWithRows("recordsV2");
        return sortByTime(Array.isArray(source.recordsV2) ? decodeUsageRowsV2(source.recordsV2, source) : data.records);
    };
    const decodeTtfbRecords = () => {
        const source = sourceWithRows("ttfbRecordsV2");
        return sortByTime(Array.isArray(source.ttfbRecordsV2) ? decodeTtfbRowsV2(source.ttfbRecordsV2, source) : data.ttfbRecords);
    };
    const decodeCompletionRecords = () => {
        const source = sourceWithRows("completionRecordsV2");
        return sortByTime(Array.isArray(source.completionRecordsV2)
            ? decodeCompletionRowsV2(source.completionRecordsV2, source)
            : (data.completionRecords || []));
    };
    const decodeFailureRecords = () => {
        const source = sourceWithRows("failureRecordsV2");
        return sortByTime(Array.isArray(source.failureRecordsV2) ? decodeFailureRowsV2(source.failureRecordsV2, source) : data.failureRecords);
    };
    let recordsCache = null;
    let completionRecordsCache = null;
    let ttfbRecordsCache = null;
    let failureRecordsCache = null;
    let rawDataPromise = null;
    const ensureRawData = () => {
        if (data.records || data.recordsV2 || window.CODEXSCOPE_RAW_DATA)
            return Promise.resolve();
        if (!rawDataPromise) {
            rawDataPromise = new Promise((resolve, reject) => {
                const script = document.createElement("script");
                const separator = rawDataPath.includes("?") ? "&" : "?";
                script.src = `${rawDataPath}${separator}codexscope-data=${encodeURIComponent(data.generatedAt || Date.now())}`;
                script.async = true;
                script.onload = () => {
                    script.remove();
                    if (!window.CODEXSCOPE_RAW_DATA) {
                        rawDataPromise = null;
                        reject(new Error("raw data missing"));
                        return;
                    }
                    recordsCache = null;
                    completionRecordsCache = null;
                    ttfbRecordsCache = null;
                    failureRecordsCache = null;
                    resolve();
                };
                script.onerror = () => {
                    script.remove();
                    rawDataPromise = null;
                    reject(new Error(`failed to load ${rawDataPath}`));
                };
                document.head.appendChild(script);
            });
        }
        return rawDataPromise;
    };
    const getRecords = () => recordsCache || (recordsCache = decodeRecords());
    const getCompletionRecords = () => completionRecordsCache || (completionRecordsCache = decodeCompletionRecords());
    const getTtfbRecords = () => ttfbRecordsCache || (ttfbRecordsCache = decodeTtfbRecords());
    const getFailureRecords = () => failureRecordsCache || (failureRecordsCache = decodeFailureRecords());
    let precomputedViews = data.views || {};
    let limits = data.limits || {};
    let summary = data.summary || {};
    let trendRows = data.trend || [];
    let distributionRows = [];
    let sessionRows = data.sessions || [];
    let modelRows = data.models || [];
    let costModelRows = [];
    let riskRows = data.risk || [];
    let costSummary = {};
    const fxState = {
        usdCny: 6.8012,
        date: "2026-05-08",
        source: "ECB 参考汇率",
        status: "fallback",
    };
    const EXCHANGE_RATE_URL = "https://api.frankfurter.dev/v2/rate/USD/CNY?providers=ECB";
    let latestDataTime = Number((data.availableRange || {}).end) || Date.now();
    let earliestDataTime = Number((data.availableRange || {}).start) || latestDataTime;
    let firstDataTime = Number.isFinite(earliestDataTime) ? earliestDataTime : latestDataTime;
    const rangeNow = () => Math.min(Date.now(), latestDataTime);
    const lowerBound = (rows, ts) => {
        let lo = 0;
        let hi = rows.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (recordTime(rows[mid]) < ts)
                lo = mid + 1;
            else
                hi = mid;
        }
        return lo;
    };
    const upperBound = (rows, ts) => {
        let lo = 0;
        let hi = rows.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (recordTime(rows[mid]) <= ts)
                lo = mid + 1;
            else
                hi = mid;
        }
        return lo;
    };
    const rowsInRange = (rows, range) => rows.slice(lowerBound(rows, range.start), upperBound(rows, range.end));
    const successFailureRates = (requests, failures) => {
        const requestCount = Math.max(0, Number(requests) || 0);
        const failureCount = Math.max(0, Number(failures) || 0);
        if (!requestCount) {
            return failureCount ? { successRate: 0, failureRate: 100 } : { successRate: 100, failureRate: 0 };
        }
        const failureRate = clampPercent(failureCount / requestCount * 100);
        return { successRate: 100 - failureRate, failureRate };
    };
    const quotaRiskRow = (name, remaining, used, reset, tone) => {
        if (remaining === null || remaining === undefined) {
            return {
                name,
                value: null,
                label: "等待数据",
                note: "本地日志暂无 rate_limits",
                tone,
                percentLabel: "--",
            };
        }
        const value = clampPercent(remaining);
        return {
            name,
            value,
            label: `${pct(value)} 剩余`,
            note: `已用 ${pct(used || 0)} · ${reset || "--"}`,
            tone,
            percentLabel: pct(value),
        };
    };
    const localDayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const ymd = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    };
    const parseYmdStart = (value) => {
        if (!value)
            return null;
        const [y, m, d] = value.split("-").map(Number);
        if (!y || !m || !d)
            return null;
        return new Date(y, m - 1, d).getTime();
    };
    const formatBucketLabel = (ts, stepMs, range) => {
        const date = new Date(ts);
        const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        if (stepMs >= DAY)
            return `${date.getMonth() + 1}/${date.getDate()}`;
        if (range.end - range.start > DAY)
            return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
        return time;
    };
    const formatStepLabel = (stepMs) => {
        if (stepMs < HOUR)
            return `${Math.round(stepMs / MINUTE)}分钟/点`;
        if (stepMs < DAY)
            return `${Math.round(stepMs / HOUR)}小时/点`;
        return `${Math.round(stepMs / DAY)}天/点`;
    };
    const chooseNiceStep = (duration, targetPoints) => {
        const ideal = duration / targetPoints;
        const steps = [
            MINUTE,
            2 * MINUTE,
            5 * MINUTE,
            10 * MINUTE,
            15 * MINUTE,
            30 * MINUTE,
            HOUR,
            2 * HOUR,
            3 * HOUR,
            6 * HOUR,
            12 * HOUR,
            DAY,
            2 * DAY,
            3 * DAY,
            7 * DAY,
            14 * DAY,
            30 * DAY,
        ];
        return steps.find((step) => step >= ideal) || steps[steps.length - 1];
    };
    const formatPeakLabel = (ts, range) => {
        if (!Number.isFinite(ts))
            return "--";
        const date = new Date(ts);
        const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        return range.end - range.start > DAY ? `${date.getMonth() + 1}/${date.getDate()} ${time}` : time;
    };
    const formatRangeLabel = (start, end, preset) => {
        if (preset === "24h")
            return "最近24小时";
        if (preset === "today")
            return "今天";
        if (preset === "7")
            return "7天内";
        if (preset === "30")
            return "30天内";
        if (preset === "history")
            return "历史总览";
        return `${ymd(new Date(start))} 至 ${ymd(new Date(end - 1))}`;
    };
    const fmt = (value) => {
        value = Number(value) || 0;
        if (Math.abs(value) >= 1e9)
            return `${(value / 1e9).toFixed(2)}B`;
        if (Math.abs(value) >= 1e6)
            return `${(value / 1e6).toFixed(2)}M`;
        if (Math.abs(value) >= 1e3)
            return `${Math.round(value / 1e3)}K`;
        return `${Math.round(value)}`;
    };
    const detailedNumber = (value) => Math.round(Number(value) || 0).toLocaleString("en-US");
    const convertCost = (value) => {
        const amount = Number(value) || 0;
        return uiState.currency === "CNY" ? amount * fxState.usdCny : amount;
    };
    const money = (value) => {
        const amount = convertCost(value);
        if (uiState.currency === "CNY") {
            if (Math.abs(amount) >= 1000)
                return `¥${Math.round(amount).toLocaleString()}`;
            return `¥${amount.toFixed(2)}`;
        }
        if (Math.abs(amount) >= 1000)
            return `$${Math.round(amount).toLocaleString()}`;
        return `$${amount.toFixed(2)}`;
    };
    const moneyCompact = (value) => {
        const amount = convertCost(value);
        if (uiState.currency === "CNY") {
            if (Math.abs(amount) >= 1000)
                return `¥${Math.round(amount).toLocaleString()}`;
            if (Math.abs(amount) >= 100)
                return `¥${amount.toFixed(0)}`;
            return `¥${amount.toFixed(2)}`;
        }
        if (Math.abs(amount) >= 1000)
            return `$${Math.round(amount).toLocaleString()}`;
        if (Math.abs(amount) >= 100)
            return `$${amount.toFixed(0)}`;
        return `$${amount.toFixed(2)}`;
    };
    const moneyDetailed = (value) => {
        const amount = convertCost(value);
        const symbol = uiState.currency === "CNY" ? "¥" : "$";
        const absolute = Math.abs(amount);
        if (!absolute)
            return `${symbol}0.00`;
        if (absolute >= 1000)
            return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
        const decimals = absolute >= 1 ? 2 : absolute >= .01 ? 4 : absolute >= .0001 ? 6 : 8;
        const precise = amount.toFixed(decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
        return `${symbol}${precise}`;
    };
    const normalizePricingRules = (rules) => Array.isArray(rules)
        ? rules.map((rule) => ({
            label: String(rule?.label || rule?.patterns?.[0] || "unknown"),
            patterns: (Array.isArray(rule?.patterns) ? rule.patterns : [rule?.pattern])
                .map((pattern) => String(pattern || "").toLowerCase())
                .filter(Boolean),
            input: Number(rule?.input) || 0,
            cached: Number(rule?.cached) || 0,
            output: Number(rule?.output) || 0,
        })).filter((rule) => rule.patterns.length && (rule.input || rule.cached || rule.output))
        : [];
    let pricingRules = normalizePricingRules(data.pricingRules || window.CODEXSCOPE_SAMPLE_DATA?.pricingRules);
    const pricingCache = new Map();
    let recordCostCache = new WeakMap();
    const pricingForModel = (model) => {
        const key = String(model || "").toLowerCase();
        if (!pricingCache.has(key)) {
            pricingCache.set(key, pricingRules.find((rule) => rule.patterns.some((pattern) => key.includes(pattern))) || null);
        }
        return pricingCache.get(key);
    };
    const priceRate = (value) => {
        const amount = Number(value) || 0;
        const decimals = amount > 0 && amount < 1 && !Number.isInteger(amount * 100) ? 3 : 2;
        return `$${amount.toFixed(decimals)}`;
    };
    const renderPricingHelp = () => {
        const body = $("priceTableBody");
        if (!body)
            return;
        if (!pricingRules.length) {
            body.innerHTML = `<tr><td colspan="4">等待价格表</td></tr>`;
            return;
        }
        body.innerHTML = pricingRules.map((rule) => `
      <tr>
        <td>${esc(rule.label)}</td>
        <td>${esc(priceRate(rule.input))}</td>
        <td>${esc(priceRate(rule.cached))}</td>
        <td>${esc(priceRate(rule.output))}</td>
      </tr>`).join("");
    };
    const emptyCost = () => ({ input: 0, cached: 0, output: 0, reasoning: 0, total: 0, pricedTokens: 0, unpricedTokens: 0 });
    const addCost = (target, source) => {
        target.input += source.input || 0;
        target.cached += source.cached || 0;
        target.output += source.output || 0;
        target.reasoning += source.reasoning || 0;
        target.total += source.total || 0;
        target.pricedTokens += source.pricedTokens || 0;
        target.unpricedTokens += source.unpricedTokens || 0;
        return target;
    };
    const priceRecord = (record) => {
        const cachedCost = recordCostCache.get(record);
        if (cachedCost)
            return cachedCost;
        const model = record[2] || "unknown";
        const pricing = pricingForModel(model);
        const inputTokens = Math.max(0, Number(record[3]) || 0);
        const cachedRaw = Math.max(0, Number(record[4]) || 0);
        const outputTokens = Math.max(0, Number(record[5]) || 0);
        const reasoningRaw = Math.max(0, Number(record[6]) || 0);
        const cachedTokens = inputTokens ? Math.min(inputTokens, cachedRaw) : cachedRaw;
        const billableInput = Math.max(0, inputTokens - cachedTokens);
        const billedReasoning = Math.min(outputTokens, reasoningRaw);
        const visibleOutput = Math.max(0, outputTokens - billedReasoning);
        const pricedTokens = billableInput + cachedTokens + visibleOutput + billedReasoning;
        if (!pricing) {
            const result = { ...emptyCost(), unpricedTokens: pricedTokens };
            recordCostCache.set(record, result);
            return result;
        }
        const multiplier = 1 / 1000000;
        const input = billableInput * pricing.input * multiplier;
        const cached = cachedTokens * pricing.cached * multiplier;
        const output = visibleOutput * pricing.output * multiplier;
        const reasoning = billedReasoning * pricing.output * multiplier;
        const result = {
            input,
            cached,
            output,
            reasoning,
            total: input + cached + output + reasoning,
            pricedTokens,
            unpricedTokens: 0,
        };
        recordCostCache.set(record, result);
        return result;
    };
    const rangeForPreset = (preset) => {
        const now = rangeNow();
        const today = localDayStart(new Date(now)).getTime();
        const todayLabel = today === localDayStart(new Date(Date.now())).getTime() ? "今天" : ymd(new Date(today));
        if (preset === "24h")
            return { start: now - DAY, end: now, preset, label: "最近24小时" };
        if (preset === "today")
            return { start: today, end: now, preset, label: todayLabel };
        if (preset === "7")
            return { start: today - 6 * DAY, end: now, preset, label: "7天内" };
        if (preset === "30")
            return { start: today - 29 * DAY, end: now, preset, label: "30天内" };
        if (preset === "history")
            return { start: Math.min(firstDataTime, now), end: now, preset, label: "历史总览" };
        const startInput = parseYmdStart($("startDate")?.value) ?? today;
        const endInput = parseYmdStart($("endDate")?.value) ?? today;
        const start = Math.min(startInput, endInput);
        const end = Math.min(now, Math.max(startInput, endInput) + DAY);
        return { start, end, preset: "custom", label: formatRangeLabel(start, end, "custom") };
    };
    const emptyUsage = () => ({ input: 0, cached: 0, output: 0, reasoning: 0, total: 0, requests: 0, cost: 0 });
    const buildBuckets = (filtered, range, step, recordCosts = null) => {
        const duration = Math.max(1, range.end - range.start);
        const safeStep = Math.max(MINUTE, step || chooseNiceStep(duration, 180));
        const start = Math.floor(range.start / safeStep) * safeStep;
        const end = Math.ceil(range.end / safeStep) * safeStep;
        const bucketCount = Math.max(1, Math.ceil((end - start) / safeStep));
        const buckets = Array.from({ length: bucketCount }, (_, index) => ({
            ...emptyUsage(),
            start: start + index * safeStep,
            end: index === bucketCount - 1 ? end + 1 : start + (index + 1) * safeStep,
        }));
        for (let index = 0; index < filtered.length; index += 1) {
            const record = filtered[index];
            const idx = Math.max(0, Math.min(bucketCount - 1, Math.floor((record[0] - start) / safeStep)));
            const bucket = buckets[idx];
            bucket.input += record[3] || 0;
            bucket.cached += record[4] || 0;
            bucket.output += record[5] || 0;
            bucket.reasoning += record[6] || 0;
            bucket.total += record[7] || 0;
            bucket.requests += 1;
            bucket.cost += (recordCosts?.[index] || priceRecord(record)).total || 0;
        }
        return buckets.map((bucket) => ({
            ...bucket,
            label: formatBucketLabel(bucket.start, safeStep, range),
            stepMinutes: safeStep / MINUTE,
            stepLabel: formatStepLabel(safeStep),
        }));
    };
    const computePeakRate = (filtered, range) => {
        let left = 0;
        let sum = 0;
        let peakTotal = 0;
        let peakTs = NaN;
        for (let right = 0; right < filtered.length; right += 1) {
            const current = filtered[right];
            const currentTs = recordTime(current);
            sum += Number(current[7]) || 0;
            while (left <= right && currentTs - recordTime(filtered[left]) >= RATE_WINDOW_MS) {
                sum -= Number(filtered[left][7]) || 0;
                left += 1;
            }
            if (sum > peakTotal) {
                peakTotal = sum;
                peakTs = currentTs;
            }
        }
        return {
            total: peakTotal,
            label: formatPeakLabel(peakTs, range),
            tpm: peakTotal / (RATE_WINDOW_MS / 60000),
        };
    };
    const medianMillis = (values) => {
        if (!values.length)
            return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2
            ? sorted[middle]
            : Math.trunc((sorted[middle - 1] + sorted[middle]) / 2);
    };
    const percentileMillis = (values, percentile) => {
        if (!values.length)
            return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1));
        return sorted[rank];
    };
    const computeStats = (range) => {
        const records = getRecords();
        const completionRecords = getCompletionRecords();
        const failureRecords = getFailureRecords();
        const ttfbRecords = getTtfbRecords();
        const filtered = rowsInRange(records, range);
        const completions = rowsInRange(completionRecords, range);
        const failures = rowsInRange(failureRecords, range);
        const ttfb = rowsInRange(ttfbRecords, range);
        const totals = emptyUsage();
        const costs = emptyCost();
        const bySession = new Map();
        const byModel = new Map();
        const sessionCatalog = getSessionsCatalog();
        const recordCosts = new Array(filtered.length);
        for (let index = 0; index < filtered.length; index += 1) {
            const record = filtered[index];
            const recordCost = priceRecord(record);
            recordCosts[index] = recordCost;
            addCost(costs, recordCost);
            totals.input += record[3] || 0;
            totals.cached += record[4] || 0;
            totals.output += record[5] || 0;
            totals.reasoning += record[6] || 0;
            totals.total += record[7] || 0;
            totals.requests += 1;
            const sid = record[1] || "unknown";
            const model = record[2] || "unknown";
            const effort = record[9] || "unknown";
            const catalog = sessionCatalog[sid] || {};
            const session = bySession.get(sid) || {
                id: sid,
                name: catalog.name || `会话 ${sid.slice(-6)}`,
                model,
                latestModel: model,
                latestEffort: effort,
                latestAt: 0,
                tokens: 0,
                requests: 0,
                status: "ok",
                modelBreakdown: new Map(),
                effortBreakdown: new Map(),
                ttfbValues: [],
                durationValues: [],
            };
            if (recordTime(record) >= session.latestAt) {
                session.latestAt = recordTime(record);
                session.model = model;
                session.latestModel = model;
                session.latestEffort = effort;
            }
            session.tokens += record[7] || 0;
            session.requests += 1;
            const modelPart = session.modelBreakdown.get(model) || { model, tokens: 0, requests: 0 };
            modelPart.tokens += record[7] || 0;
            modelPart.requests += 1;
            session.modelBreakdown.set(model, modelPart);
            const effortPart = session.effortBreakdown.get(effort) || { effort, tokens: 0, requests: 0 };
            effortPart.tokens += record[7] || 0;
            effortPart.requests += 1;
            session.effortBreakdown.set(effort, effortPart);
            bySession.set(sid, session);
            const modelRow = byModel.get(model) || { name: model, tokens: 0, requests: 0, cost: 0, latencyTotal: 0, latencyCount: 0 };
            modelRow.tokens += record[7] || 0;
            modelRow.requests += 1;
            modelRow.cost += recordCost.total || 0;
            byModel.set(model, modelRow);
        }
        for (const record of completions) {
            const session = bySession.get(record[1] || "unknown");
            if (!session)
                continue;
            if ((record[4] || 0) > 0)
                session.ttfbValues.push(record[4]);
            if ((record[3] || 0) > 0)
                session.durationValues.push(record[3]);
        }
        for (const record of failures) {
            const session = bySession.get(record[1] || "unknown");
            if (session)
                session.status = "warn";
        }
        for (const record of ttfb) {
            const model = record[2] || "unknown";
            const modelRow = byModel.get(model) || { name: model, tokens: 0, requests: 0, cost: 0, latencyTotal: 0, latencyCount: 0 };
            modelRow.latencyTotal += record[3] || 0;
            modelRow.latencyCount += 1;
            byModel.set(model, modelRow);
        }
        const duration = Math.max(1, range.end - range.start);
        const trendBuckets = filtered.length
            ? buildBuckets(filtered, range, chooseNiceStep(duration, 180), recordCosts)
            : [];
        const distributionBuckets = filtered.length
            ? buildBuckets(filtered, range, chooseNiceStep(duration, 32), recordCosts)
            : [];
        const peak = computePeakRate(filtered, range);
        const cacheHit = totals.input ? totals.cached / totals.input * 100 : 0;
        const { successRate, failureRate } = successFailureRates(totals.requests, failures.length);
        const sessions = Array.from(bySession.values()).sort((a, b) => b.tokens - a.tokens);
        const maxSessionTokens = Math.max(1, ...sessions.map((row) => row.tokens));
        const maxSessionRequests = Math.max(1, ...sessions.map((row) => row.requests));
        const models = Array.from(byModel.values()).sort((a, b) => b.tokens - a.tokens).slice(0, 12);
        const maxModelTokens = Math.max(1, ...models.map((row) => row.tokens));
        const costModels = Array.from(byModel.values()).sort((a, b) => b.cost - a.cost).slice(0, 4);
        const maxModelCost = Math.max(1, ...costModels.map((row) => row.cost));
        const costParts = [
            { key: "input", name: "输入", value: costs.input, className: "cost-input" },
            { key: "cached", name: "缓存", value: costs.cached, className: "cost-cache" },
            { key: "output", name: "输出", value: costs.output, className: "cost-output" },
            { key: "reasoning", name: "推理", value: costs.reasoning, className: "cost-reasoning" },
        ].map((part) => ({
            ...part,
            percent: costs.total ? part.value / costs.total * 100 : 0,
        }));
        return {
            label: range.label,
            summary: {
                totalTokensLabel: fmt(totals.total),
                inputLabel: fmt(totals.input),
                cachedLabel: fmt(totals.cached),
                outputLabel: fmt(totals.output),
                reasoningLabel: fmt(totals.reasoning),
                requestsLabel: totals.requests.toLocaleString(),
                failures: failures.length,
                successRateLabel: `${successRate.toFixed(1)}%`,
                cacheHitLabel: `${cacheHit.toFixed(1)}%`,
                peakLabel: fmt(peak.total),
                peakTime: peak.label,
                peakTpmLabel: `${fmt(peak.tpm)} TPM`,
            },
            cost: {
                total: costs.total,
                average: totals.requests ? costs.total / totals.requests : 0,
                rangeTokensLabel: fmt(totals.total),
                parts: costParts,
                unpricedTokens: costs.unpricedTokens,
            },
            trend: trendBuckets,
            distribution: distributionBuckets,
            sessions: sessions.map((row, index) => ({
                id: row.id,
                rank: index + 1,
                name: row.name,
                model: row.model,
                latestModel: row.latestModel,
                latestEffort: row.latestEffort,
                modelBreakdown: Array.from(row.modelBreakdown.values()).sort((a, b) => b.tokens - a.tokens || String(a.model).localeCompare(String(b.model))),
                effortBreakdown: Array.from(row.effortBreakdown.values()).sort((a, b) => b.tokens - a.tokens || String(a.effort).localeCompare(String(b.effort))),
                ttfbMedianMs: medianMillis(row.ttfbValues),
                ttfbP90Ms: percentileMillis(row.ttfbValues, 0.9),
                durationMedianMs: medianMillis(row.durationValues),
                durationP90Ms: percentileMillis(row.durationValues, 0.9),
                tokens: row.tokens,
                requests: row.requests,
                status: row.status,
                tokensLabel: fmt(row.tokens),
                tokenPercent: Math.round(row.tokens / maxSessionTokens * 100),
                requestPercent: Math.round(row.requests / maxSessionRequests * 100),
            })),
            models: models.map((row) => ({
                name: row.name,
                tokens: row.tokens,
                tokensLabel: fmt(row.tokens),
                requests: row.requests,
                latency: row.latencyCount ? row.latencyTotal / row.latencyCount / 1000 : 0,
                latencyLabel: row.latencyCount ? `${(row.latencyTotal / row.latencyCount / 1000).toFixed(2)}s` : "--",
                cost: row.cost || 0,
                percent: Math.round(row.tokens / maxModelTokens * 100),
            })),
            costModels: costModels.map((row, index) => ({
                name: row.name,
                rank: index + 1,
                cost: row.cost || 0,
                percent: Math.round((row.cost || 0) / maxModelCost * 100),
            })),
            risk: [
                quotaRiskRow("5h 窗口", limits.primaryRemaining ?? null, limits.primaryUsed, limits.primaryReset, "blue"),
                quotaRiskRow("周限额", limits.secondaryRemaining ?? null, limits.secondaryUsed, limits.secondaryReset, "teal"),
                { name: "缓存", value: cacheHit, label: `命中 ${cacheHit.toFixed(0)}%`, note: "输入 token", tone: "teal" },
                { name: "失败", value: failureRate, label: `${failureRate.toFixed(1)}%`, note: `${failures.length} 次失败`, tone: "amber" },
            ],
        };
    };
    const normalizeTrendRows = (rows, stepLabel = "", stepMinutes = 0) => (rows || []).map((row) => Array.isArray(row)
        ? {
            label: row[0] || "",
            total: row[1] || 0,
            cached: row[2] || 0,
            output: row[3] || 0,
            input: row[4] || 0,
            reasoning: row[5] || 0,
            requests: row[6] || 0,
            cost: row[7] || 0,
            stepLabel,
            stepMinutes,
        }
        : row);
    const normalizeDistributionRows = (rows) => (rows || []).map((row) => Array.isArray(row)
        ? {
            label: row[0] || "",
            total: row[1] || 0,
            requests: row[2] || 0,
            cost: row[3] || 0,
        }
        : row);
    const emptyStatsForRange = (range, message = "") => ({
        label: range.label,
        summary: {
            totalTokensLabel: "--",
            inputLabel: "--",
            cachedLabel: "--",
            outputLabel: "--",
            reasoningLabel: "--",
            requestsLabel: "0",
            failures: 0,
            successRateLabel: "--",
            cacheHitLabel: "--",
            peakLabel: "--",
            peakTime: "--",
            peakTpmLabel: "--",
            loadError: message,
        },
        cost: { ...emptyCost(), average: 0, rangeTokensLabel: "--", parts: [] },
        trend: [],
        distribution: [],
        sessions: [],
        models: [],
        costModels: [],
        risk: [],
    });
    const statsForRange = (range) => {
        const view = range.preset !== "custom" ? precomputedViews[range.preset] : null;
        if (view) {
            return {
                label: range.label || view.label,
                summary: view.summary || {},
                cost: view.cost || { ...emptyCost(), parts: [] },
                trend: normalizeTrendRows(view.trend, view.trendStepLabel, view.trendStepMinutes),
                distribution: normalizeDistributionRows(view.distribution),
                sessions: view.sessions || [],
                models: view.models || [],
                costModels: view.costModels || [],
                risk: view.risk || [],
            };
        }
        return ensureRawData().then(() => computeStats(range));
    };
    let rangeRequestSeq = 0;
    let activeRangePreset = "today";
    const applyStats = (stats) => {
        summary = stats.summary;
        summary.rangeLabel = stats.label;
        trendRows = stats.trend;
        distributionRows = stats.distribution;
        sessionRows = stats.sessions;
        modelRows = stats.models;
        costModelRows = stats.costModels;
        riskRows = stats.risk;
        costSummary = stats.cost;
        setText("tokenTotal", summary.totalTokensLabel || "--");
        setText("inputTokens", summary.inputLabel || "--");
        setText("cachedTokens", summary.cachedLabel || "--");
        setText("outputTokens", summary.outputLabel || "--");
        setText("reasoningTokens", summary.reasoningLabel || "--");
        setText("requestCount", summary.requestsLabel || "0");
        setText("successRate", summary.successRateLabel || "--");
        setText("failureCount", summary.failures ?? "0");
        setText("cacheHit", summary.cacheHitLabel || "--");
        setText("peakRate", (summary.peakTpmLabel || "--").replace(/\s*TPM$/, ""));
        setText("chartMeta", `累计 ${summary.totalTokensLabel || "--"}`);
    };
    let isSampleData = data.sample === true;
    const quotaSourceLabel = (withPrefix = true) => {
        const limitId = String(limits.limitId || "").toLowerCase();
        const limitName = String(limits.limitName || "");
        const plan = String(limits.planType || "").toUpperCase();
        let label = "额度状态";
        if (isSampleData) {
            label = "示例数据";
        }
        else if (limitId === "codex") {
            label = plan && plan !== "UNKNOWN" ? `Codex ${plan} 全局额度` : "Codex 全局额度";
        }
        else if (limitName) {
            label = `${limitName} 限额`;
        }
        else if (limitId) {
            label = `${limitId} 限额`;
        }
        return withPrefix ? `来源：${label}` : label;
    };
    const setRing = (selector, remain, radius) => {
        const el = document.querySelector(selector);
        if (!el || remain === null || remain === undefined)
            return;
        const circumference = Math.PI * 2 * radius;
        el.style.strokeDasharray = `${circumference * Math.max(0, Math.min(100, remain)) / 100} ${circumference}`;
    };
    const renderDataMetadata = () => {
        isSampleData = data.sample === true;
        setText("sourcePrimary", isSampleData ? "示例数据" : "Codex 桌面端");
        setText("sourceSecondary", isSampleData ? "直接预览" : "本地日志");
        setText("sourceTertiary", isSampleData ? "运行脚本看真实数据" : quotaSourceLabel(false));
        setText("quotaSource", quotaSourceLabel(true));
        setText("syncText", isSampleData ? "Demo 预览" : `${data.generatedAt?.slice(11, 16) || "--"} 已同步`);
        const primaryRemain = limits.primaryRemaining ?? null;
        const secondaryRemain = limits.secondaryRemaining ?? null;
        const hasLimitData = primaryRemain !== null || secondaryRemain !== null;
        setText("shieldState", limits.rateLimitReachedType ? "已触发限流" : hasLimitData ? "当前安全" : "等待数据");
        setText("primaryRemain", primaryRemain === null ? "等待数据" : pct(primaryRemain));
        setText("secondaryRemain", secondaryRemain === null ? "等待数据" : pct(secondaryRemain));
        setText("primaryNote", primaryRemain === null ? "本地日志暂无 rate_limits" : `已用 ${pct(limits.primaryUsed)} · reset ${limits.primaryReset || "--"}`);
        setText("secondaryNote", secondaryRemain === null ? "本地日志暂无 rate_limits" : `已用 ${pct(limits.secondaryUsed)} · reset ${limits.secondaryReset || "--"}`);
        const primaryFill = $("primaryFill");
        if (primaryFill)
            primaryFill.style.width = primaryRemain === null ? "0%" : pct(primaryRemain);
        const secondaryFill = $("secondaryFill");
        if (secondaryFill)
            secondaryFill.style.width = secondaryRemain === null ? "0%" : pct(secondaryRemain);
        setText("planType", (limits.planType || "Pro").toUpperCase());
        setRing(".ring-main", primaryRemain ?? 0, 76);
        setRing(".ring-teal", secondaryRemain ?? 0, 58);
    };
    renderDataMetadata();
    const niceMax = (value) => {
        if (!value)
            return 1000;
        const pow = Math.pow(10, Math.floor(Math.log10(value)));
        return Math.ceil(value / pow) * pow;
    };
    const compact = (value) => {
        if (value >= 1e9)
            return `${(value / 1e9).toFixed(1)}B`;
        if (value >= 1e6)
            return `${(value / 1e6).toFixed(1)}M`;
        if (value >= 1e3)
            return `${Math.round(value / 1e3)}K`;
        return `${Math.round(value)}`;
    };
    const tinyToken = (value) => {
        value = Number(value) || 0;
        if (Math.abs(value) >= 1e9)
            return `${(value / 1e9).toFixed(1)}B`;
        if (Math.abs(value) >= 1e6)
            return `${Math.round(value / 1e6)}M`;
        if (Math.abs(value) >= 1e3)
            return `${Math.round(value / 1e3)}K`;
        return `${Math.round(value)}`;
    };
    const smoothPath = (points) => {
        if (!points.length)
            return "";
        if (points.length < 2)
            return `M${points[0][0]} ${points[0][1]}`;
        const minY = Math.min(...points.map((point) => point[1]));
        const maxY = Math.max(...points.map((point) => point[1]));
        const clampY = (value) => Math.max(minY, Math.min(maxY, value));
        let d = `M${points[0][0]} ${points[0][1]}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i - 1] || points[i];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[i + 2] || p2;
            const c1x = p1[0] + (p2[0] - p0[0]) / 6;
            const c1y = clampY(p1[1] + (p2[1] - p0[1]) / 6);
            const c2x = p2[0] - (p3[0] - p1[0]) / 6;
            const c2y = clampY(p2[1] - (p3[1] - p1[1]) / 6);
            d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0]} ${p2[1]}`;
        }
        return d;
    };
    const sparkPath = (rows, key, width = 126, height = 42) => {
        const values = (rows || []).map((row) => Number(row[key]) || 0);
        if (!values.length)
            return "";
        const maxValue = Math.max(1, ...values);
        const pad = 2;
        const points = values.map((value, index) => [
            Math.round(pad + (width - pad * 2) * index / Math.max(1, values.length - 1)),
            Math.round(height - pad - (height - pad * 2) * value / maxValue),
        ]);
        return smoothPath(points);
    };
    const setPath = (id, d) => {
        const path = $(id);
        if (path)
            path.setAttribute("d", d);
    };
    const chartInteractionState = (id) => {
        if (!uiState.chartInteractions[id]) {
            uiState.chartInteractions[id] = { index: -1, pinned: false, visible: false };
        }
        return uiState.chartInteractions[id];
    };
    const chartTooltipMarkup = (title, lines) => `
    <strong>${esc(title)}</strong>
    ${lines.map((line) => `<span><i style="--series-color:${line.color || "var(--blue-2)"}"></i>${esc(line.label)} <b>${esc(line.value)}</b></span>`).join("")}`;
    const chartKindFor = (id) => uiState.chartKinds[id] === "bar" ? "bar" : "line";
    const syncChartKindControls = (target = "") => {
        document.querySelectorAll(`.chart-kind${target ? `[data-chart-target="${target}"]` : ""}`).forEach((button) => {
            const active = button.dataset.chartKind === chartKindFor(button.dataset.chartTarget || "");
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    };
    const interactionPoint = (config, index) => {
        if (typeof config.point === "function")
            return config.point(index, config.rows[index]);
        return {
            x: config.rows.length > 1 ? index / (config.rows.length - 1) : .5,
            y: .5,
        };
    };
    const chartPointToClient = (element, point) => {
        const normalizedX = Math.max(0, Math.min(1, Number(point?.x) || 0));
        const normalizedY = Math.max(0, Math.min(1, Number(point?.y) || 0));
        if (element instanceof SVGSVGElement) {
            const viewBox = element.viewBox?.baseVal;
            const matrix = element.getScreenCTM();
            if (viewBox?.width && viewBox?.height && matrix) {
                const svgPoint = element.createSVGPoint();
                svgPoint.x = viewBox.x + normalizedX * viewBox.width;
                svgPoint.y = viewBox.y + normalizedY * viewBox.height;
                const clientPoint = svgPoint.matrixTransform(matrix);
                return { x: clientPoint.x, y: clientPoint.y };
            }
        }
        const rect = element.getBoundingClientRect();
        return {
            x: rect.left + normalizedX * rect.width,
            y: rect.top + normalizedY * rect.height,
        };
    };
    const chartClientBounds = (element) => {
        if (element instanceof SVGSVGElement) {
            const viewBox = element.viewBox?.baseVal;
            const matrix = element.getScreenCTM();
            if (viewBox?.width && viewBox?.height && matrix) {
                const first = element.createSVGPoint();
                first.x = viewBox.x;
                first.y = viewBox.y;
                const last = element.createSVGPoint();
                last.x = viewBox.x + viewBox.width;
                last.y = viewBox.y + viewBox.height;
                const start = first.matrixTransform(matrix);
                const end = last.matrixTransform(matrix);
                return {
                    left: Math.min(start.x, end.x),
                    top: Math.min(start.y, end.y),
                    width: Math.abs(end.x - start.x),
                    height: Math.abs(end.y - start.y),
                };
            }
        }
        return element.getBoundingClientRect();
    };
    const chartPointerRatio = (event, element) => {
        if (element instanceof SVGSVGElement) {
            const viewBox = element.viewBox?.baseVal;
            const matrix = element.getScreenCTM();
            if (viewBox?.width && matrix) {
                const clientPoint = element.createSVGPoint();
                clientPoint.x = event.clientX;
                clientPoint.y = event.clientY;
                const localPoint = clientPoint.matrixTransform(matrix.inverse());
                return (localPoint.x - viewBox.x) / viewBox.width;
            }
        }
        const rect = element.getBoundingClientRect();
        return rect.width ? (event.clientX - rect.left) / rect.width : 0;
    };
    const syncChartInteraction = (config, index, visible = true) => {
        const element = config.element;
        const rows = config.rows || [];
        const state = chartInteractionState(config.id);
        const host = (config.host || element.parentElement);
        if (!host || !rows.length) {
            state.visible = false;
            return;
        }
        const safeIndex = Math.max(0, Math.min(rows.length - 1, Number(index) || 0));
        state.index = safeIndex;
        state.visible = visible || state.pinned;
        const row = rows[safeIndex];
        const point = interactionPoint(config, safeIndex);
        element.setAttribute("aria-valuemin", "0");
        element.setAttribute("aria-valuemax", String(rows.length - 1));
        element.setAttribute("aria-valuenow", String(safeIndex));
        element.setAttribute("aria-valuetext", config.ariaText(row, safeIndex));
        element.dataset.chartPinned = String(state.pinned);
        element.dataset.chartSelectedIndex = String(safeIndex);
        host.classList.add("chart-interaction-host");
        let tooltip = host.querySelector(`[data-chart-tooltip="${config.id}"]`);
        if (!tooltip) {
            tooltip = document.createElement("div");
            tooltip.className = "chart-interaction-tooltip";
            tooltip.dataset.chartTooltip = config.id;
            tooltip.setAttribute("role", "tooltip");
            tooltip.setAttribute("aria-live", "polite");
            host.appendChild(tooltip);
        }
        let crosshair = host.querySelector(`[data-chart-crosshair="${config.id}"]`);
        if (!crosshair) {
            crosshair = document.createElement("span");
            crosshair.className = "chart-interaction-crosshair";
            crosshair.dataset.chartCrosshair = config.id;
            host.appendChild(crosshair);
        }
        let marker = host.querySelector(`[data-chart-marker="${config.id}"]`);
        if (!marker) {
            marker = document.createElement("span");
            marker.className = "chart-interaction-marker";
            marker.dataset.chartMarker = config.id;
            host.appendChild(marker);
        }
        const elementRect = chartClientBounds(element);
        const hostRect = host.getBoundingClientRect();
        const configuredClientPoint = typeof config.clientPoint === "function" ? config.clientPoint(safeIndex, row) : null;
        const clientPoint = configuredClientPoint && Number.isFinite(configuredClientPoint.x) && Number.isFinite(configuredClientPoint.y)
            ? configuredClientPoint
            : chartPointToClient(element, point);
        const left = clientPoint.x - hostRect.left;
        const top = clientPoint.y - hostRect.top;
        const boundedLeft = Math.max(8, Math.min(Math.max(8, hostRect.width - 8), left));
        const boundedTop = Math.max(8, Math.min(Math.max(8, hostRect.height - 8), top));
        tooltip.innerHTML = config.tooltip(row, safeIndex);
        tooltip.style.left = `${boundedLeft}px`;
        tooltip.style.top = `${boundedTop}px`;
        tooltip.classList.toggle("align-right", boundedLeft > hostRect.width * .62);
        tooltip.classList.toggle("place-below", boundedTop < 58);
        tooltip.hidden = !state.visible;
        crosshair.style.left = `${left}px`;
        crosshair.style.top = `${Math.max(0, elementRect.top - hostRect.top)}px`;
        crosshair.style.height = `${elementRect.height}px`;
        crosshair.hidden = !state.visible;
        marker.style.left = `${left}px`;
        marker.style.top = `${top}px`;
        marker.hidden = !state.visible;
    };
    const hideChartInteraction = (config) => {
        if (!config?.id)
            return;
        const state = chartInteractionState(config.id);
        if (state.pinned)
            return;
        state.visible = false;
        const host = (config.host || config.element.parentElement);
        host?.querySelector(`[data-chart-tooltip="${config.id}"]`)?.setAttribute("hidden", "");
        host?.querySelector(`[data-chart-crosshair="${config.id}"]`)?.setAttribute("hidden", "");
        host?.querySelector(`[data-chart-marker="${config.id}"]`)?.setAttribute("hidden", "");
    };
    const clearChartInteraction = (id, element = null, host = null) => {
        const target = element;
        const active = target ? target.__codexScopeChartConfig : null;
        const interactionHost = (host || active?.host || target?.parentElement);
        const state = chartInteractionState(id);
        state.index = -1;
        state.pinned = false;
        state.visible = false;
        if (target) {
            delete target.__codexScopeChartConfig;
            delete target.dataset.chartId;
            delete target.dataset.chartPinned;
            delete target.dataset.chartSelectedIndex;
            ["role", "tabindex", "aria-label", "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"].forEach((name) => target.removeAttribute(name));
        }
        interactionHost?.querySelector(`[data-chart-tooltip="${id}"]`)?.remove();
        interactionHost?.querySelector(`[data-chart-crosshair="${id}"]`)?.remove();
        interactionHost?.querySelector(`[data-chart-marker="${id}"]`)?.remove();
        if (!interactionHost?.querySelector("[data-chart-tooltip], [data-chart-crosshair], [data-chart-marker]")) {
            interactionHost?.classList.remove("chart-interaction-host");
        }
    };
    const chartIndexFromPointer = (event, config) => {
        if (typeof config.indexFromEvent === "function") {
            const selected = config.indexFromEvent(event);
            if (Number.isInteger(selected))
                return selected;
        }
        const start = Number(config.xStart ?? 0);
        const end = Number(config.xEnd ?? 1);
        const ratio = chartPointerRatio(event, config.element);
        const plotRatio = Math.max(0, Math.min(1, (ratio - start) / Math.max(.001, end - start)));
        return Math.round(plotRatio * Math.max(0, config.rows.length - 1));
    };
    const bindChartInteraction = (config) => {
        const element = config.element;
        if (!element)
            return;
        element.dataset.chartId = config.id;
        element.setAttribute("role", "slider");
        element.setAttribute("tabindex", "0");
        element.setAttribute("aria-label", config.label);
        element.removeAttribute("aria-hidden");
        element.__codexScopeChartConfig = config;
        if (!element.__codexScopeChartBound) {
            element.__codexScopeChartBound = true;
            let dragging = false;
            const currentConfig = () => element.__codexScopeChartConfig;
            element.addEventListener("pointermove", (event) => {
                const active = currentConfig();
                if (!active?.rows?.length)
                    return;
                syncChartInteraction(active, chartIndexFromPointer(event, active), true);
            });
            element.addEventListener("pointerdown", (event) => {
                const active = currentConfig();
                if (!active?.rows?.length)
                    return;
                dragging = true;
                const state = chartInteractionState(active.id);
                state.pinned = false;
                syncChartInteraction(active, chartIndexFromPointer(event, active), true);
                element.setPointerCapture?.(event.pointerId);
            });
            element.addEventListener("pointerup", (event) => {
                const active = currentConfig();
                if (!active?.rows?.length || !dragging)
                    return;
                dragging = false;
                const state = chartInteractionState(active.id);
                state.pinned = true;
                syncChartInteraction(active, chartIndexFromPointer(event, active), true);
                element.releasePointerCapture?.(event.pointerId);
            });
            element.addEventListener("pointercancel", () => { dragging = false; });
            element.addEventListener("pointerleave", () => hideChartInteraction(currentConfig()));
            element.addEventListener("keydown", (event) => {
                const active = currentConfig();
                if (!active?.rows?.length)
                    return;
                const state = chartInteractionState(active.id);
                const last = active.rows.length - 1;
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    const current = state.index >= 0 ? state.index : (event.key === "ArrowLeft" || event.key === "End" ? last : 0);
                    const next = event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "ArrowLeft" ? Math.max(0, current - 1) : Math.min(last, current + 1);
                    state.pinned = false;
                    syncChartInteraction(active, next, true);
                    return;
                }
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    state.pinned = !state.pinned;
                    syncChartInteraction(active, state.index >= 0 ? state.index : last, true);
                    return;
                }
                if (event.key === "Escape") {
                    state.pinned = false;
                    hideChartInteraction(active);
                }
            });
        }
        const state = chartInteractionState(config.id);
        const initialIndex = state.index >= 0 ? Math.min(state.index, config.rows.length - 1) : Math.max(0, config.rows.length - 1);
        syncChartInteraction(config, initialIndex, state.pinned || state.visible);
        if (!state.pinned && !state.visible)
            hideChartInteraction(config);
    };
    const seriesConfig = {
        total: { label: "总量", color: "var(--blue)", width: 3, area: "areaBlue" },
        cached: { label: "缓存", color: "var(--teal)", width: 2.6, area: "areaTeal" },
        output: { label: "输出", color: "var(--sky)", width: 2.2 },
        input: { label: "输入", color: "var(--blue-2)", width: 2.2 },
        reasoning: { label: "推理", color: "var(--violet)", width: 2.2 },
    };
    const trendValueKeys = ["total", "cached", "output", "input", "reasoning"];
    const trendRowsForMode = (rows) => {
        if (uiState.trendMode === "interval") {
            return rows;
        }
        const running = { total: 0, cached: 0, output: 0, input: 0, reasoning: 0 };
        return rows.map((row) => {
            trendValueKeys.forEach((key) => {
                running[key] += Number(row[key]) || 0;
            });
            return { ...row, ...running };
        });
    };
    const renderTrendControls = () => {
        document.querySelectorAll(".trend-mode").forEach((button) => {
            button.classList.toggle("active", button.dataset.trendMode === uiState.trendMode);
        });
        document.querySelectorAll(".trend-scale").forEach((button) => {
            button.classList.toggle("active", button.dataset.trendScale === uiState.trendScale);
        });
        document.querySelectorAll(".legend-item[data-series]").forEach((button) => {
            const key = button.dataset.series;
            const active = !!uiState.trendSeries[key];
            const check = button.querySelector(".check");
            const config = seriesConfig[key] || {};
            button.classList.toggle("off", !active);
            button.setAttribute("aria-pressed", String(active));
            button.title = `${active ? "隐藏" : "显示"}${config.label || key}曲线`;
            if (check) {
                const tone = active
                    ? `${key === "cached" ? " teal" : ""}${key === "output" ? " sky" : ""}${key === "reasoning" ? " violet" : ""}`
                    : "";
                check.className = `check${active ? " on" : ""}${tone}`;
                check.innerHTML = active ? `<svg viewBox="0 0 16 16"><path d="m4 8 2.3 2.4L12 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` : "";
                if (active && key === "input")
                    check.style.background = config.color || "";
                else
                    check.style.background = "";
            }
        });
    };
    const renderChart = () => {
        const svg = $("trendChart");
        const baseRows = trendRows || [];
        if (!svg)
            return;
        renderTrendControls();
        syncChartKindControls("trend");
        const chartKind = chartKindFor("trend");
        svg.dataset.chartKind = chartKind;
        svg.setAttribute("aria-label", `Token 消耗${chartKind === "bar" ? "柱状" : "折线"}图`);
        if (baseRows.length < 2) {
            clearChartInteraction("trend", svg, svg.parentElement);
            setText("chartMeta", summary.loadError || `累计 ${summary.totalTokensLabel || "--"}`);
            svg.innerHTML = "";
            return;
        }
        const rows = trendRowsForMode(baseRows);
        const activeKeys = trendValueKeys.filter((key) => uiState.trendSeries[key]);
        if (!activeKeys.length) {
            clearChartInteraction("trend", svg, svg.parentElement);
            return;
        }
        const primaryKey = activeKeys.includes("total") ? "total" : activeKeys[0];
        const primaryConfig = seriesConfig[primaryKey];
        const compactChart = window.innerWidth <= 480;
        const maxY = niceMax(Math.max(...rows.flatMap((row) => activeKeys.map((key) => row[key] || 0))));
        const logScale = uiState.trendScale === "log";
        const logMax = Math.max(1, Math.log10(maxY + 1));
        const left = compactChart ? 14 : 40;
        const right = compactChart ? 990 : 985;
        const top = 22, bottom = 194;
        const plotWidth = right - left;
        const barSlotWidth = plotWidth / Math.max(1, rows.length);
        const x = (index) => chartKind === "bar"
            ? left + barSlotWidth * (index + .5)
            : left + plotWidth * index / Math.max(1, rows.length - 1);
        const barGroupWidth = Math.max(.8, Math.min(26, barSlotWidth * .78));
        const barGap = activeKeys.length > 1 ? Math.min(1.2, barGroupWidth * .06) : 0;
        const barWidth = Math.max(.35, (barGroupWidth - barGap * (activeKeys.length - 1)) / activeKeys.length);
        const seriesX = (index, key) => {
            if (chartKind !== "bar")
                return x(index);
            const seriesIndex = Math.max(0, activeKeys.indexOf(key));
            return x(index) - barGroupWidth / 2 + seriesIndex * (barWidth + barGap) + barWidth / 2;
        };
        const y = (value) => {
            const safeValue = Math.max(0, Number(value) || 0);
            const ratio = logScale ? Math.log10(safeValue + 1) / logMax : safeValue / maxY;
            return Math.round(bottom - (bottom - top) * ratio);
        };
        const series = (key) => rows.map((row, index) => [seriesX(index, key), y(row[key] || 0)]);
        const primary = series(primaryKey);
        const peakIndex = uiState.trendMode === "interval"
            ? rows.reduce((best, row, index) => (row[primaryKey] || 0) > (rows[best][primaryKey] || 0) ? index : best, 0)
            : rows.length - 1;
        const peakPoint = primary[peakIndex];
        const area = (points) => `${smoothPath(points)} L${points[points.length - 1][0]} ${bottom} L${points[0][0]} ${bottom} Z`;
        const yTicks = logScale
            ? [maxY, maxY / 10, maxY / 100, maxY / 1000, maxY / 10000, 0].filter((tick, index, all) => index === all.length - 1 || tick >= 1)
            : [1, .8, .6, .4, .2, 0].map((ratio) => Math.round(maxY * ratio));
        const labelEvery = Math.max(1, Math.ceil(rows.length / (compactChart ? 3 : 7)));
        const showXLabel = (index) => index === 0 || index === rows.length - 1 || index === peakIndex || index % labelEvery === 0;
        const xLabels = rows.map((row, index) => showXLabel(index)
            ? `<text x="${x(index) - 16}" y="211" class="chart-label">${esc(row.label)}</text>`
            : "").join("");
        const gridLines = yTicks.filter((tick) => tick > 0).map((tick) => `<line x1="${left}" y1="${y(tick)}" x2="${right}" y2="${y(tick)}" class="grid-line"/>`).join("");
        const yLabels = compactChart ? "" : yTicks.map((tick) => `<text x="${tick === 0 ? 22 : 2}" y="${Math.min(198, y(tick) + 4)}" class="chart-label">${compact(tick)}</text>`).join("");
        const metaPrefix = uiState.trendMode === "interval" ? "分时峰值" : "累计";
        const metaLabel = `${metaPrefix} ${primaryConfig.label} ${fmt(rows[peakIndex][primaryKey] || 0)}`;
        const stepLabel = baseRows[0]?.stepLabel ? ` · ${baseRows[0].stepLabel}` : "";
        setText("chartMeta", `${metaLabel}${stepLabel}`);
        const areaPath = `<path data-series-area="${primaryKey}" d="${area(primary)}" fill="url(#areaSelected)"/>`;
        const linePaths = activeKeys.map((key) => {
            const config = seriesConfig[key];
            return `<path data-series="${key}" d="${smoothPath(series(key))}" fill="none" stroke="${config.color}" stroke-width="${config.width}" stroke-linecap="round"/>`;
        }).join("");
        const barRects = rows.map((row, index) => activeKeys.map((key, seriesIndex) => {
            const config = seriesConfig[key];
            const barX = x(index) - barGroupWidth / 2 + seriesIndex * (barWidth + barGap);
            const barY = y(row[key] || 0);
            return `<rect data-series="${key}" data-chart-index="${index}" x="${barX.toFixed(2)}" y="${barY}" width="${barWidth.toFixed(2)}" height="${Math.max(0, bottom - barY)}" rx="${Math.min(2.5, barWidth / 2).toFixed(2)}" fill="${config.color}" opacity="${key === primaryKey ? ".92" : ".68"}"/>`;
        }).join("")).join("");
        const chartVisuals = chartKind === "bar" ? barRects : `${areaPath}${linePaths}`;
        svg.innerHTML = `
      <defs>
        <linearGradient id="areaSelected" x1="0" y1="0" x2="0" y2="1">
          <stop stop-color="${primaryConfig.color}" stop-opacity=".16"/>
          <stop offset="1" stop-color="${primaryConfig.color}" stop-opacity=".02"/>
        </linearGradient>
      </defs>
      ${gridLines}
      <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="axis-line"/>
      ${yLabels}
      ${chartVisuals}
      <line x1="${peakPoint[0]}" y1="${peakPoint[1]}" x2="${peakPoint[0]}" y2="${bottom}" stroke="${primaryConfig.color}" stroke-width="1.5" stroke-dasharray="6 5"/>
      <circle cx="${peakPoint[0]}" cy="${peakPoint[1]}" r="9" fill="#fff" stroke="${primaryConfig.color}" stroke-width="2"/>
      <circle cx="${peakPoint[0]}" cy="${peakPoint[1]}" r="4.6" fill="${primaryConfig.color}"/>
      ${xLabels}
    `;
        bindChartInteraction({
            id: "trend",
            element: svg,
            host: svg.parentElement,
            rows,
            label: "Token 时间节点，左右方向键移动，Enter 固定提示",
            xStart: x(0) / 1000,
            xEnd: x(rows.length - 1) / 1000,
            point: (index) => ({ x: primary[index][0] / 1000, y: y(rows[index]?.[primaryKey] || 0) / 214 }),
            tooltip: (row) => chartTooltipMarkup(row.label || "--", activeKeys.map((key) => ({
                label: seriesConfig[key].label,
                value: `${detailedNumber(row[key] || 0)} Token`,
                color: seriesConfig[key].color,
            }))),
            ariaText: (row) => `${row.label || "--"}，${activeKeys.map((key) => `${seriesConfig[key].label} ${detailedNumber(row[key] || 0)} Token`).join("，")}`,
        });
    };
    const formatLatency = (value) => {
        const milliseconds = Math.max(0, Number(value) || 0);
        if (!milliseconds)
            return "--";
        return milliseconds < 1000 ? `${Math.round(milliseconds)}ms` : `${(milliseconds / 1000).toFixed(2)}s`;
    };
    const sessionKeyFor = (row, index) => String(row.id || row.sid || `legacy-${legacySessionRenderEpoch}-${index}`);
    const renderSessionBreakdown = (rows, key, emptyLabel) => {
        if (!Array.isArray(rows) || !rows.length)
            return `<span class="session-detail-empty">${emptyLabel}</span>`;
        return rows.map((row) => `
      <span class="session-detail-chip">
        <strong>${esc(row[key] || "unknown")}</strong>
        <span>${esc(fmt(row.tokens || 0))} Token · ${esc(row.requests || 0)} 次</span>
      </span>`).join("");
    };
    const renderSessionDetail = (row, index, sessionKey) => `
    <div class="session-detail" id="sessionDetail-${index}" data-session-index="${index}" data-session-key="${esc(sessionKey)}" role="region" aria-label="${esc(row.name)} 会话详情">
      <div class="session-detail-group">
        <span class="session-detail-label">模型分布</span>
        <div class="session-detail-chips">${renderSessionBreakdown(row.modelBreakdown, "model", "暂无模型明细")}</div>
      </div>
      <div class="session-detail-group">
        <span class="session-detail-label">推理程度</span>
        <div class="session-detail-chips">${renderSessionBreakdown(row.effortBreakdown, "effort", "暂无推理档位")}</div>
      </div>
      <div class="session-latency-grid">
        <div><span>TTFB 中位数</span><strong>${formatLatency(row.ttfbMedianMs)}</strong></div>
        <div><span>TTFB P90</span><strong>${formatLatency(row.ttfbP90Ms)}</strong></div>
        <div><span>整轮耗时中位数</span><strong>${formatLatency(row.durationMedianMs)}</strong></div>
        <div><span>整轮耗时 P90</span><strong>${formatLatency(row.durationP90Ms)}</strong></div>
      </div>
    </div>`;
    const renderSessions = () => {
        const allRows = sessionRows || [];
        const query = uiState.sessionQuery.trim().toLowerCase();
        const matchingRows = query
            ? allRows.filter((row) => `${row.name || ""} ${row.model || ""} ${row.latestEffort || ""} ${(row.modelBreakdown || []).map((part) => part.model).join(" ")}`.toLowerCase().includes(query))
            : allRows;
        const tokenMode = uiState.sessionMode !== "requests";
        document.querySelectorAll(".session-mode").forEach((button) => {
            button.classList.toggle("active", button.dataset.sessionMode === uiState.sessionMode);
        });
        const rankedRows = [...matchingRows]
            .sort((a, b) => {
            const primary = tokenMode ? b.tokens - a.tokens : b.requests - a.requests;
            return primary || b.tokens - a.tokens || b.requests - a.requests || String(a.name).localeCompare(String(b.name));
        })
            .slice(0, 20);
        const rows = uiState.sessionsExpanded ? rankedRows : rankedRows.slice(0, collapsedSessionLimit);
        const head = `
      <div class="session-head">
        <span>会话</span><span>模型</span><span>${tokenMode ? "Token 消耗" : "调用分布"}</span><span>${tokenMode ? "Token" : "调用数"}</span><span>状态</span>
      </div>`;
        if (!allRows.length || !matchingRows.length) {
            $("sessionList").innerHTML = head + `<div class="list-empty">${allRows.length ? "没有匹配的会话" : "当前范围没有会话调用"}</div>`;
            const toggle = $("toggleSessions");
            if (toggle)
                toggle.hidden = true;
            return;
        }
        $("sessionList").innerHTML = head + rows.map((row, index) => {
            const sessionKey = sessionKeyFor(row, index);
            const expanded = uiState.expandedSessionKey === sessionKey;
            return `
        <div class="session-entry ${expanded ? "expanded" : ""}">
          <div class="session-row" data-session-index="${index}" data-session-key="${esc(sessionKey)}" role="button" tabindex="0" aria-expanded="${expanded}" aria-controls="sessionDetail-${index}">
            <span class="rank-name"><i class="num ${index > 2 ? "muted" : ""}">${index + 1}</i><span class="rank-text">${esc(row.name)}</span></span>
            <span class="session-model-stack"><span class="pill">${esc(row.latestModel || row.model)}</span><span class="effort-pill">${esc(row.latestEffort || "unknown")}</span></span>
            <span class="mini-bar"><span style="width:${Math.max(4, tokenMode ? row.tokenPercent || 0 : row.requestPercent || 0)}%"></span></span>
            <span>${tokenMode ? esc(row.tokensLabel) : esc(row.requests)}</span>
            <span class="session-state"><span class="status ${row.status === "warn" ? "warn" : ""}"></span><span class="session-chevron" aria-hidden="true">⌄</span></span>
          </div>
          ${expanded ? renderSessionDetail(row, index, sessionKey) : ""}
        </div>`;
        }).join("");
        const toggle = $("toggleSessions");
        if (toggle) {
            toggle.hidden = rankedRows.length <= collapsedSessionLimit;
            toggle.innerHTML = uiState.sessionsExpanded ? "收起会话 <span>↑</span>" : `展开会话 <span>${rankedRows.length}</span>`;
        }
    };
    const renderModels = () => {
        const colors = ["", "teal", "sky", "violet"];
        const allRows = modelRows || [];
        const query = uiState.modelQuery.trim().toLowerCase();
        const matchingRows = query
            ? allRows.filter((row) => String(row.name || "").toLowerCase().includes(query))
            : allRows;
        const rows = uiState.modelsExpanded ? matchingRows : matchingRows.slice(0, collapsedModelLimit);
        const head = `
      <div class="session-head" style="grid-template-columns:120px 1fr 72px 62px">
        <span>模型</span><span></span><span>Token 总量</span><span>预估费用</span>
      </div>`;
        if (!allRows.length || !matchingRows.length) {
            $("modelList").innerHTML = head + `<div class="list-empty">${allRows.length ? "没有匹配的模型" : "当前范围没有模型调用"}</div>`;
            const toggle = $("toggleModels");
            if (toggle)
                toggle.hidden = true;
            return;
        }
        $("modelList").innerHTML = head + rows.map((row, index) => `
      <div class="model-row">
        <span class="name">${esc(row.name)}</span>
        <span class="bar"><span class="${colors[index] || ""}" style="width:${Math.max(4, row.percent || 0)}%"></span></span>
        <span class="tokens">${esc(row.tokensLabel)}</span>
        <span class="model-cost">${esc(money(row.cost || 0))}</span>
      </div>`).join("");
        const toggle = $("toggleModels");
        if (toggle) {
            toggle.hidden = allRows.length <= collapsedModelLimit;
            toggle.innerHTML = uiState.modelsExpanded ? "收起模型 <span>↑</span>" : `展开模型 <span>${allRows.length}</span>`;
        }
    };
    const renderRisk = () => {
        const rows = riskRows || [];
        const labels = ["▣", "◷", "◌", "!"];
        $("riskList").innerHTML = rows.map((row, index) => `
      <div class="risk-row">
        <span class="risk-icon">${labels[index] || "•"}</span><strong>${esc(row.name)}</strong>
        <span class="track"><span class="fill ${row.tone === "teal" ? "teal" : row.tone === "amber" ? "amber" : ""}" style="display:block;width:${row.value === null || row.value === undefined ? 0 : Math.max(2, Math.min(100, row.value || 0))}%"></span></span>
        <span class="value">${esc(row.label)}${row.note ? `<small>${esc(row.note)}</small>` : ""}</span><span class="percent">${esc(row.percentLabel ?? pct(row.value))}</span>
      </div>`).join("") + `
      <div class="warning">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3 22 20H2L12 3Z" fill="currentColor"/>
          <path d="M12 9v5" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
          <circle cx="12" cy="17" r="1.2" fill="#fff"/>
        </svg>
        <div>
          <strong>${esc(summary.peakTime || "--")} Token 峰值 ${esc(summary.peakLabel || "--")}</strong>
          <span>${limits.rateLimitReachedType ? "已触发限流，请降低并发。" : "未触发限流，系统运行正常。"}</span>
        </div>
        <span>›</span>
      </div>`;
    };
    const renderDistribution = () => {
        const chart = $("distributionChart");
        if (!chart)
            return;
        const chartKind = chartKindFor("distribution");
        syncChartKindControls("distribution");
        chart.dataset.chartKind = chartKind;
        document.querySelectorAll(".dist-mode").forEach((button) => {
            button.classList.toggle("active", button.dataset.distMode === uiState.distributionMode);
        });
        const rows = distributionRows || [];
        const tokenMode = uiState.distributionMode === "tokens";
        const metricKey = tokenMode ? "total" : "requests";
        const metricName = tokenMode ? "Token 消耗" : "调用";
        const unitLabel = tokenMode ? "Token" : "次调用";
        const totalValue = rows.reduce((sum, row) => sum + (row[metricKey] || 0), 0);
        const totalLabel = tokenMode ? `${fmt(totalValue)} Token` : `${totalValue.toLocaleString()} 次`;
        setText("rangeSummary", `${summary.rangeLabel || ""}${summary.rangeLabel ? " · " : ""}${totalLabel}`.replace(/^ · /, ""));
        if (!rows.length || !totalValue) {
            clearChartInteraction("distribution", chart, chart);
            chart.style.setProperty("--bar-count", "1");
            chart.innerHTML = `<div class="dist-empty">当前范围没有${metricName}记录</div>`;
            return;
        }
        const maxValue = Math.max(1, ...rows.map((row) => row[metricKey] || 0));
        chart.style.setProperty("--bar-count", String(Math.max(1, rows.length)));
        const axisMax = niceMax(maxValue);
        const yLabel = tokenMode ? tinyToken : compact;
        const plotWidth = Math.max(180, (chart.clientWidth || 520) - 54);
        const slotWidth = plotWidth / Math.max(1, rows.length);
        const showAllValueLabels = rows.length <= 10 || slotWidth >= 46;
        const valueLabelIndices = new Set();
        if (showAllValueLabels) {
            rows.forEach((_, index) => valueLabelIndices.add(index));
        }
        else {
            const maxVisibleLabels = Math.max(3, Math.min(rows.length, Math.floor(plotWidth / (slotWidth >= 30 ? 52 : 64))));
            const minLabelGap = slotWidth >= 34 ? 1 : slotWidth >= 24 ? 2 : 3;
            const placeLabel = (index) => {
                if (valueLabelIndices.size >= maxVisibleLabels)
                    return;
                for (const placed of valueLabelIndices) {
                    if (Math.abs(placed - index) < minLabelGap)
                        return;
                }
                valueLabelIndices.add(index);
            };
            const valueCutoff = Math.max(1, maxValue * 0.12);
            rows
                .map((row, index) => ({ index, value: row[metricKey] || 0 }))
                .filter((row) => row.value >= valueCutoff)
                .sort((a, b) => b.value - a.value)
                .forEach((row) => placeLabel(row.index));
            if (slotWidth >= 34) {
                [0, rows.length - 1].forEach((index) => {
                    if ((rows[index]?.[metricKey] || 0) > 0)
                        placeLabel(index);
                });
            }
        }
        const bars = rows.map((row, index) => {
            const value = row[metricKey] || 0;
            const label = tokenMode ? tinyToken(value) : String(value);
            const detailLabel = detailedNumber(value);
            const height = value ? Math.max(3, Math.round(value / axisMax * 100)) : 0;
            const showValue = valueLabelIndices.has(index);
            return `
      <div class="dist-bar" data-chart-index="${index}" aria-label="${esc(row.label)} ${esc(detailLabel)} ${unitLabel}">
        <span class="dist-bar-value${showValue ? "" : " is-hidden"}">${showValue ? esc(label) : ""}</span>
        <span class="dist-bar-fill ${tokenMode ? "token" : ""}" style="height:${height}%"></span>
        <span class="dist-bar-label">${esc(row.label)}</span>
      </div>`;
        }).join("");
        const xLabelStride = rows.length <= 8 ? 1 : rows.length <= 14 ? 2 : 3;
        const xLabelMinGap = slotWidth < 24 ? 2 : 1;
        const xLabels = rows.map((row, index) => {
            const isEdge = index === 0 || index === rows.length - 1;
            const clearsLastLabel = index <= rows.length - 1 - xLabelMinGap;
            const showLabel = isEdge || (index % xLabelStride === 0 && clearsLastLabel);
            return `<span class="dist-x-label">${showLabel ? esc(row.label) : ""}</span>`;
        }).join("");
        const lineWidth = 1000;
        const lineHeight = 180;
        const lineLeft = 12;
        const lineRight = 988;
        const lineTop = 12;
        const lineBottom = 168;
        const lineX = (index) => lineLeft + (lineRight - lineLeft) * index / Math.max(1, rows.length - 1);
        const lineY = (value) => lineBottom - (lineBottom - lineTop) * (Number(value) || 0) / axisMax;
        const linePoints = rows.map((row, index) => [lineX(index), lineY(row[metricKey] || 0)]);
        const linePath = smoothPath(linePoints);
        const lineArea = `${linePath} L${lineX(rows.length - 1)} ${lineBottom} L${lineX(0)} ${lineBottom} Z`;
        const linePlot = `
      <div class="dist-plot line-mode">
        <svg class="distribution-line-chart" width="1000" height="180" viewBox="0 0 1000 180" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="distributionArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${tokenMode ? "var(--teal)" : "var(--blue-2)"}" stop-opacity=".2"/><stop offset="1" stop-color="${tokenMode ? "var(--teal)" : "var(--blue-2)"}" stop-opacity=".02"/></linearGradient></defs>
          <path d="${lineArea}" fill="url(#distributionArea)"/>
          <path data-series="distribution" d="${linePath}" fill="none" stroke="${tokenMode ? "var(--teal)" : "var(--blue-2)"}" stroke-width="2.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        </svg>
      </div>`;
        const barPlot = `<div class="dist-plot">${bars}</div>`;
        chart.innerHTML = `
      <div class="dist-y-axis" aria-hidden="true">
        <span>${esc(yLabel(axisMax))}</span>
        <span></span>
        <span>${esc(yLabel(axisMax / 2))}</span>
        <span></span>
        <span>0</span>
      </div>
      ${chartKind === "line" ? linePlot : barPlot}
      <div class="dist-axis-spacer" aria-hidden="true"></div>
      <div class="dist-x-axis" aria-label="时间段">${xLabels}</div>`;
        bindChartInteraction({
            id: "distribution",
            element: chart,
            host: chart,
            rows,
            label: "速率分布时间节点，左右方向键移动，Enter 固定提示",
            indexFromEvent: (event) => {
                const target = event.target instanceof Element ? event.target.closest(".dist-bar[data-chart-index]") : null;
                if (target)
                    return Number(target.dataset.chartIndex);
                const plot = chart.querySelector(".dist-plot");
                if (!plot)
                    return null;
                const rect = plot.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, rect.width ? (event.clientX - rect.left) / rect.width : 0));
                if (chartKind === "bar")
                    return Math.min(rows.length - 1, Math.floor(ratio * rows.length));
                const plotRatio = Math.max(0, Math.min(1, (ratio - lineLeft / lineWidth) / ((lineRight - lineLeft) / lineWidth)));
                return Math.round(plotRatio * Math.max(0, rows.length - 1));
            },
            clientPoint: (index) => {
                if (chartKind === "bar") {
                    const fill = chart.querySelector(`.dist-bar[data-chart-index="${index}"] .dist-bar-fill`);
                    const rect = fill?.getBoundingClientRect();
                    if (rect)
                        return { x: rect.left + rect.width / 2, y: rect.top };
                }
                const lineSvg = chart.querySelector("svg.distribution-line-chart");
                return lineSvg ? chartPointToClient(lineSvg, { x: lineX(index) / lineWidth, y: lineY(rows[index]?.[metricKey] || 0) / lineHeight }) : null;
            },
            tooltip: (row) => chartTooltipMarkup(row.label || "--", [
                { label: "调用量", value: `${Math.round(row.requests || 0)} 次调用`, color: "var(--blue-2)" },
                { label: "Token", value: `${detailedNumber(row.total || 0)} Token`, color: "var(--teal)" },
                { label: "估算费用", value: moneyDetailed(row.cost || 0), color: "var(--violet)" },
            ]),
            ariaText: (row) => `${row.label || "--"}，${detailedNumber(row.requests || 0)} 次调用，${detailedNumber(row.total || 0)} Token，估算费用 ${moneyDetailed(row.cost || 0)}`,
        });
    };
    const renderCost = () => {
        const content = $("costContent");
        if (!content)
            return;
        const chartKind = chartKindFor("cost");
        syncChartKindControls("cost");
        document.querySelectorAll(".currency-mode").forEach((button) => {
            const active = button.dataset.currency === uiState.currency;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        const cost = costSummary || {};
        const parts = cost.parts || [];
        const rows = distributionRows || [];
        const totalCost = Number(cost.total) || 0;
        const hasUsage = rows.some((row) => row.requests || row.total);
        if (!hasUsage) {
            const previousChart = content.querySelector(".cost-chart");
            clearChartInteraction("cost", previousChart, previousChart);
            content.innerHTML = `<div class="list-empty">当前范围没有可估算费用的 token 用量</div>`;
            return;
        }
        const partMarkup = parts.map((part) => `
      <div class="cost-part">
        <div class="cost-name"><i class="${esc(part.className)}"></i>${esc(part.name)}</div>
        <div class="cost-value">${esc(money(part.value))}</div>
        <span class="cost-percent">${(part.percent || 0).toFixed(1)}%</span>
      </div>`).join("");
        const stackMarkup = parts.map((part) => {
            const width = totalCost ? Math.max(part.value ? 1.5 : 0, part.value / totalCost * 100) : 0;
            return `<span class="${esc(part.className)}" style="width:${width}%"></span>`;
        }).join("");
        const modelRowsMarkup = (costModelRows || []).filter((row) => row.cost > 0).slice(0, 3).map((row) => `
      <div class="cost-model-row">
        <span class="model-name">${esc(row.name)}</span>
        <span class="bar"><span style="width:${Math.max(4, row.percent || 0)}%"></span></span>
        <span>${esc(moneyCompact(row.cost || 0))}</span>
      </div>`).join("") || `<div class="list-empty">当前范围没有匹配价格的模型</div>`;
        const costBuckets = rows.map((row, index) => ({
            label: row.label,
            cost: Number(row.cost) || 0,
            total: Number(row.total) || 0,
            requests: Number(row.requests) || 0,
            index,
        }));
        const maxBucket = Math.max(0, ...costBuckets.map((row) => row.cost));
        const peakIndex = costBuckets.reduce((best, row) => row.cost > costBuckets[best].cost ? row.index : best, 0);
        const costBars = costBuckets.map((row) => {
            const height = maxBucket ? Math.max(3, Math.round(row.cost / maxBucket * 100)) : 0;
            return `<span class="${row.index === peakIndex && row.cost ? "cost-peak" : ""}" data-chart-index="${row.index}" style="height:${height}%" aria-label="${esc(row.label)} ${esc(moneyDetailed(row.cost))}"></span>`;
        }).join("");
        const costLineWidth = 1000;
        const costLineHeight = 82;
        const costLineLeft = 12;
        const costLineRight = 988;
        const costLineTop = 8;
        const costLineBottom = 68;
        const costLineX = (index) => costBuckets.length > 1
            ? costLineLeft + (costLineRight - costLineLeft) * index / (costBuckets.length - 1)
            : costLineWidth / 2;
        const costLineY = (value) => maxBucket
            ? costLineBottom - (costLineBottom - costLineTop) * (Number(value) || 0) / maxBucket
            : costLineBottom;
        const costLinePoints = costBuckets.map((row, index) => [costLineX(index), costLineY(row.cost)]);
        const costLinePath = smoothPath(costLinePoints);
        const costLineArea = `${costLinePath} L${costLineX(costBuckets.length - 1)} ${costLineBottom} L${costLineX(0)} ${costLineBottom} Z`;
        const costLine = `
      <svg class="cost-line-chart" width="1000" height="82" viewBox="0 0 1000 82" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="costLineArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="var(--blue-2)" stop-opacity=".25"/><stop offset="1" stop-color="var(--blue-2)" stop-opacity=".02"/></linearGradient></defs>
        <path d="${costLineArea}" fill="url(#costLineArea)"/>
        <path data-series="cost" d="${costLinePath}" fill="none" stroke="var(--blue-2)" stroke-width="2.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>`;
        const firstLabel = costBuckets[0]?.label || "--";
        const lastLabel = costBuckets[costBuckets.length - 1]?.label || "--";
        const fxNote = uiState.currency === "CNY"
            ? `${fxState.source} ${fxState.date}，1 USD≈${fxState.usdCny.toFixed(4)} CNY${fxState.status === "fallback" ? "（离线兜底）" : ""}`
            : "当前显示 USD；切换 CNY 时按 ECB 参考汇率换算。";
        content.innerHTML = `
      <div class="cost-summary">
        <div class="cost-kicker">${uiState.currency === "USD" ? "美元估算" : "人民币换算"}</div>
        <div class="cost-total">${esc(money(cost.total || 0))}</div>
        <div class="cost-stats">
          <div class="cost-stat"><span>平均</span><b>${esc(money(cost.average || 0))} / 调用</b></div>
          <div class="cost-stat"><span>本区间</span><b>${esc(cost.rangeTokensLabel || "--")}</b></div>
        </div>
      </div>
      <div class="cost-composition">
        <h4 class="cost-subtitle">成本构成</h4>
        <div class="cost-stack" aria-label="成本构成">${stackMarkup}</div>
        <div class="cost-parts">${partMarkup}</div>
      </div>
      <div class="cost-bottom">
        <div>
          <h4 class="cost-mini-title">模型费用排行</h4>
          <div class="cost-model-list">${modelRowsMarkup}</div>
        </div>
        <div class="cost-trend">
          <h4 class="cost-mini-title">费用走势</h4>
          <div class="cost-chart" data-chart-kind="${chartKind}" aria-label="费用走势">${chartKind === "line" ? costLine : costBars}</div>
          <div class="cost-axis"><span>${esc(firstLabel)}</span><span>${esc(lastLabel)}</span></div>
        </div>
      </div>
      <div class="cost-footnote">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3.2 19 6.5v5.2c0 4.4-2.8 7.3-7 9.1-4.2-1.8-7-4.7-7-9.1V6.5l7-3.3Z" fill="#eaf3ff" stroke="currentColor" stroke-width="1.8"/>
          <path d="m8.8 12.1 2.1 2.1 4.4-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>按 OpenAI API 标准短上下文价格和本地 token 估算；ChatGPT/Codex 实际账单与额度以官方为准。${esc(fxNote)}</span>
      </div>`;
        const costChart = content.querySelector(".cost-chart");
        if (costChart && costBuckets.length) {
            bindChartInteraction({
                id: "cost",
                element: costChart,
                host: costChart,
                rows: costBuckets,
                label: "费用走势时间节点，左右方向键移动，Enter 固定提示",
                indexFromEvent: (event) => {
                    const target = event.target instanceof Element ? event.target.closest("[data-chart-index]") : null;
                    if (target)
                        return Number(target.dataset.chartIndex);
                    const lineSvg = costChart.querySelector("svg.cost-line-chart");
                    const rect = (lineSvg || costChart).getBoundingClientRect();
                    const ratio = Math.max(0, Math.min(1, rect.width ? (event.clientX - rect.left) / rect.width : 0));
                    const plotRatio = chartKind === "line"
                        ? Math.max(0, Math.min(1, (ratio - costLineLeft / costLineWidth) / ((costLineRight - costLineLeft) / costLineWidth)))
                        : ratio;
                    return chartKind === "bar"
                        ? Math.min(costBuckets.length - 1, Math.floor(plotRatio * costBuckets.length))
                        : Math.round(plotRatio * Math.max(0, costBuckets.length - 1));
                },
                clientPoint: (index, row) => {
                    if (chartKind === "bar") {
                        const bar = costChart.querySelector(`[data-chart-index="${index}"]`);
                        const rect = bar?.getBoundingClientRect();
                        if (rect)
                            return { x: rect.left + rect.width / 2, y: rect.top };
                    }
                    const lineSvg = costChart.querySelector("svg.cost-line-chart");
                    return lineSvg ? chartPointToClient(lineSvg, { x: costLineX(index) / costLineWidth, y: costLineY(row.cost) / costLineHeight }) : null;
                },
                tooltip: (row) => chartTooltipMarkup(row.label || "--", [
                    { label: "费用", value: moneyDetailed(row.cost || 0), color: "var(--blue-2)" },
                    { label: "Token", value: `${detailedNumber(row.total || 0)} Token`, color: "var(--teal)" },
                    { label: "调用量", value: `${detailedNumber(row.requests || 0)} 次调用`, color: "var(--violet)" },
                ]),
                ariaText: (row) => `${row.label || "--"}，费用 ${moneyDetailed(row.cost || 0)}，${detailedNumber(row.total || 0)} Token，${detailedNumber(row.requests || 0)} 次调用`,
            });
        }
    };
    const renderSparks = () => {
        const requestRows = (distributionRows || []).map((row) => ({ ...row, value: Number(row.requests) || 0 }));
        const rateRows = (trendRows || []).map((row) => ({
            ...row,
            value: (Number(row.total) || 0) / Math.max(1, Number(row.stepMinutes) || 1),
        }));
        const cacheRows = (trendRows || []).map((row) => ({
            ...row,
            value: row.input ? (Number(row.cached) || 0) / Number(row.input) * 100 : 0,
        }));
        const bindSpark = (svgId, pathId, id, rows, height, metricLabel, valueLabel) => {
            const svg = $(svgId);
            if (!svg)
                return;
            const chartKind = chartKindFor(id);
            syncChartKindControls(id);
            svg.dataset.chartKind = chartKind;
            if (!rows.length) {
                clearChartInteraction(id, svg, svg.closest(".metric"));
                svg.innerHTML = "";
                return;
            }
            const values = rows.map((row) => Number(row.value) || 0);
            const maxValue = Math.max(1, ...values);
            const width = 126;
            const pad = 2;
            const plotWidth = width - pad * 2;
            const lineX = (index) => rows.length > 1 ? pad + plotWidth * index / (rows.length - 1) : width / 2;
            const slotWidth = plotWidth / Math.max(1, rows.length);
            const barWidth = Math.max(1, Math.min(10, slotWidth * .64));
            const barX = (index) => pad + slotWidth * (index + .5);
            const y = (value) => height - pad - (height - pad * 2) * value / maxValue;
            if (chartKind === "bar") {
                svg.innerHTML = values.map((value, index) => {
                    const topY = y(value);
                    return `<rect data-chart-index="${index}" x="${(barX(index) - barWidth / 2).toFixed(2)}" y="${topY.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(0, height - pad - topY).toFixed(2)}" rx="${Math.min(2, barWidth / 2).toFixed(2)}" fill="var(--blue-2)" opacity=".82"/>`;
                }).join("");
            }
            else {
                svg.innerHTML = `<path id="${pathId}" data-series="${id}" d="${sparkPath(rows, "value", width, height)}" fill="none" stroke="var(--blue-2)" stroke-width="${height === 36 ? 2 : 2.2}" stroke-linecap="round"/>`;
            }
            bindChartInteraction({
                id,
                element: svg,
                host: svg.closest(".metric"),
                rows,
                label: `${metricLabel}时间节点，左右方向键移动，Enter 固定提示`,
                xStart: (chartKind === "bar" ? barX(0) : lineX(0)) / width,
                xEnd: (chartKind === "bar" ? barX(rows.length - 1) : lineX(rows.length - 1)) / width,
                point: (index) => ({
                    x: (chartKind === "bar" ? barX(index) : lineX(index)) / width,
                    y: y(values[index]) / height,
                }),
                tooltip: (row) => chartTooltipMarkup(row.label || "--", [{ label: metricLabel, value: valueLabel(row.value) }]),
                ariaText: (row) => `${row.label || "--"}，${metricLabel} ${valueLabel(row.value)}`,
            });
        };
        bindSpark("requestSparkChart", "requestSpark", "requests", requestRows, 42, "调用量", (value) => `${detailedNumber(value)} 次调用`);
        bindSpark("peakSparkChart", "peakSpark", "peak-rate", rateRows, 42, "Token 速率", (value) => `${detailedNumber(value)} TPM`);
        bindSpark("cacheSparkChart", "cacheSpark", "cache-hit", cacheRows, 36, "缓存命中率", (value) => `${Number(value || 0).toFixed(1)}%`);
    };
    const renderAll = () => {
        renderChart();
        renderDistribution();
        renderSparks();
        renderSessions();
        renderModels();
        renderRisk();
        renderCost();
    };
    const refreshExchangeRate = async () => {
        try {
            const response = await fetch(EXCHANGE_RATE_URL, { cache: "no-store" });
            if (!response.ok)
                throw new Error(`fx ${response.status}`);
            const payload = await response.json();
            const rate = Number(payload.rate);
            if (!Number.isFinite(rate) || rate <= 0)
                throw new Error("fx invalid");
            fxState.usdCny = rate;
            fxState.date = payload.date || "latest";
            fxState.status = "live";
            renderCost();
        }
        catch {
            fxState.status = "fallback";
            renderCost();
        }
    };
    const applyRange = (preset, options = {}) => {
        activeRangePreset = preset;
        const custom = preset === "custom";
        $("customRange").hidden = !custom;
        document.querySelectorAll(".period-btn").forEach((button) => {
            button.classList.toggle("active", button.dataset.range === preset);
        });
        if (!options.preserveUiState) {
            uiState.sessionsExpanded = false;
            uiState.expandedSessionKey = "";
            uiState.modelsExpanded = false;
        }
        const range = rangeForPreset(preset);
        const requestSeq = ++rangeRequestSeq;
        const result = statsForRange(range);
        if (result && typeof result.then === "function") {
            return result.then((stats) => {
                if (requestSeq !== rangeRequestSeq)
                    return false;
                applyStats(stats);
                renderAll();
                return true;
            }).catch(() => {
                if (requestSeq !== rangeRequestSeq)
                    return false;
                applyStats(emptyStatsForRange(range, "无法加载原始记录"));
                renderAll();
                const chart = $("distributionChart");
                if (chart)
                    chart.innerHTML = `<div class="dist-empty">无法加载原始记录</div>`;
                setText("rangeSummary", `${range.label || "自定义范围"} · 无法加载原始记录`);
                return false;
            });
        }
        if (requestSeq !== rangeRequestSeq)
            return Promise.resolve(false);
        applyStats(result);
        renderAll();
        return Promise.resolve(true);
    };
    const startDateInput = $("startDate");
    const endDateInput = $("endDate");
    const syncAvailableRangeInputs = (resetValues = false) => {
        if (!startDateInput || !endDateInput)
            return;
        const availableStart = new Date(firstDataTime || Date.now() - 29 * DAY);
        const availableEnd = new Date(latestDataTime || Date.now());
        startDateInput.min = ymd(availableStart);
        startDateInput.max = ymd(availableEnd);
        endDateInput.min = ymd(availableStart);
        endDateInput.max = ymd(availableEnd);
        if (resetValues || !startDateInput.value)
            startDateInput.value = ymd(localDayStart(availableEnd));
        if (resetValues || !endDateInput.value)
            endDateInput.value = ymd(localDayStart(availableEnd));
    };
    syncAvailableRangeInputs(true);
    if (startDateInput && endDateInput) {
        startDateInput.addEventListener("change", () => applyRange("custom"));
        endDateInput.addEventListener("change", () => applyRange("custom"));
    }
    document.querySelectorAll(".period-btn").forEach((button) => {
        button.addEventListener("click", () => applyRange(button.dataset.range || "today"));
    });
    document.querySelectorAll(".chart-kind").forEach((button) => {
        button.addEventListener("click", () => {
            const target = button.dataset.chartTarget || "";
            const kind = button.dataset.chartKind === "bar" ? "bar" : "line";
            if (!target || !(target in uiState.chartKinds))
                return;
            uiState.chartKinds[target] = kind;
            syncChartKindControls(target);
            if (target === "trend")
                renderChart();
            else if (target === "distribution")
                renderDistribution();
            else if (target === "cost")
                renderCost();
            else
                renderSparks();
        });
    });
    document.querySelectorAll(".trend-scale").forEach((button) => {
        button.addEventListener("click", () => {
            uiState.trendScale = button.dataset.trendScale || "linear";
            renderChart();
        });
    });
    document.querySelectorAll(".trend-mode").forEach((button) => {
        button.addEventListener("click", () => {
            uiState.trendMode = button.dataset.trendMode === "interval" ? "interval" : "cumulative";
            renderChart();
        });
    });
    document.querySelectorAll(".legend-item[data-series]").forEach((button) => {
        button.addEventListener("click", () => {
            const key = button.dataset.series;
            if (!key || !seriesConfig[key])
                return;
            const activeCount = Object.values(uiState.trendSeries).filter(Boolean).length;
            if (uiState.trendSeries[key] && activeCount <= 1)
                return;
            uiState.trendSeries[key] = !uiState.trendSeries[key];
            renderChart();
        });
    });
    document.querySelectorAll(".dist-mode").forEach((button) => {
        button.addEventListener("click", () => {
            uiState.distributionMode = button.dataset.distMode || "calls";
            renderDistribution();
        });
    });
    document.querySelectorAll(".session-mode").forEach((button) => {
        button.addEventListener("click", () => {
            uiState.sessionMode = button.dataset.sessionMode === "requests" ? "requests" : "tokens";
            uiState.sessionsExpanded = false;
            renderSessions();
        });
    });
    $("sessionSearch")?.addEventListener("input", (event) => {
        uiState.sessionQuery = event.target.value;
        uiState.sessionsExpanded = false;
        renderSessions();
    });
    $("modelSearch")?.addEventListener("input", (event) => {
        uiState.modelQuery = event.target.value;
        uiState.modelsExpanded = false;
        renderModels();
    });
    document.querySelectorAll(".currency-mode").forEach((button) => {
        button.addEventListener("click", () => {
            uiState.currency = button.dataset.currency === "CNY" ? "CNY" : "USD";
            renderModels();
            renderCost();
            if (uiState.currency === "CNY" && fxState.status === "fallback")
                refreshExchangeRate();
        });
    });
    const costHelp = $("costHelp");
    if (costHelp) {
        const closeCostHelp = () => costHelp.setAttribute("aria-expanded", "false");
        costHelp.addEventListener("click", (event) => {
            event.stopPropagation();
            const expanded = costHelp.getAttribute("aria-expanded") === "true";
            costHelp.setAttribute("aria-expanded", String(!expanded));
        });
        document.addEventListener("click", (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target?.closest(".cost-help-wrap"))
                closeCostHelp();
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape")
                closeCostHelp();
        });
    }
    window.CODEXSCOPE_APPLY_DATA = async (nextData) => {
        if (!nextData || typeof nextData !== "object")
            return false;
        data = nextData;
        legacySessionRenderEpoch += 1;
        window.CODEXSCOPE_DATA = nextData;
        window.CODEXSCOPE_RAW_DATA = undefined;
        rawDataPath = data.rawDataPath || "data.raw.js";
        precomputedViews = data.views || {};
        limits = data.limits || {};
        latestDataTime = Number((data.availableRange || {}).end) || Date.now();
        earliestDataTime = Number((data.availableRange || {}).start) || latestDataTime;
        firstDataTime = Number.isFinite(earliestDataTime) ? earliestDataTime : latestDataTime;
        sessionsCatalogCache = null;
        sessionsCatalogRowsCache = null;
        recordsCache = null;
        completionRecordsCache = null;
        ttfbRecordsCache = null;
        failureRecordsCache = null;
        rawDataPromise = null;
        pricingRules = normalizePricingRules(data.pricingRules || window.CODEXSCOPE_SAMPLE_DATA?.pricingRules);
        pricingCache.clear();
        recordCostCache = new WeakMap();
        renderPricingHelp();
        renderDataMetadata();
        syncAvailableRangeInputs();
        return applyRange(activeRangePreset, { preserveUiState: true });
    };
    renderPricingHelp();
    applyRange("today");
    $("toggleSessions")?.addEventListener("click", () => {
        uiState.sessionsExpanded = !uiState.sessionsExpanded;
        renderSessions();
    });
    const toggleSessionDetail = (sessionKey) => {
        uiState.expandedSessionKey = uiState.expandedSessionKey === sessionKey ? "" : sessionKey;
        renderSessions();
    };
    $("sessionList")?.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target.closest(".session-row[data-session-key]") : null;
        if (target?.dataset.sessionKey)
            toggleSessionDetail(target.dataset.sessionKey);
    });
    $("sessionList")?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ")
            return;
        const target = event.target instanceof Element ? event.target.closest(".session-row[data-session-key]") : null;
        if (!target?.dataset.sessionKey)
            return;
        event.preventDefault();
        toggleSessionDetail(target.dataset.sessionKey);
    });
    $("toggleModels")?.addEventListener("click", () => {
        uiState.modelsExpanded = !uiState.modelsExpanded;
        renderModels();
    });
    const dashboardTabIds = ["overview", "quota", "token", "session", "model", "rate"];
    const tabButtons = Array.from(document.querySelectorAll('.tab[role="tab"][data-tab]'));
    const tabPanels = Array.from(document.querySelectorAll('[role="tabpanel"][data-tab-panel]'));
    const dashboardTabId = (value) => (dashboardTabIds.includes(value) ? value : "overview");
    const tabFromHash = () => dashboardTabId(decodeURIComponent(window.location.hash.slice(1)));
    const activateTab = (tabId, options = {}) => {
        const activeTab = dashboardTabId(tabId);
        const activeHash = `#${activeTab}`;
        uiState.activeTab = activeTab;
        tabButtons.forEach((button) => {
            const selected = button.dataset.tab === activeTab;
            button.classList.toggle("active", selected);
            button.setAttribute("aria-selected", String(selected));
            button.tabIndex = selected ? 0 : -1;
            if (selected && options.focus) {
                button.focus();
                button.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
            }
        });
        tabPanels.forEach((panel) => {
            const selected = panel.dataset.tabPanel === activeTab;
            panel.hidden = !selected;
            panel.classList.toggle("active", selected);
        });
        if (options.updateHistory && window.location.hash !== activeHash) {
            window.history.pushState(null, "", activeHash);
        }
        else if (!options.updateHistory && window.location.hash !== activeHash) {
            window.history.replaceState(null, "", activeHash);
        }
        window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    };
    tabButtons.forEach((tab, index) => {
        tab.addEventListener("click", () => {
            activateTab(dashboardTabId(tab.dataset.tab), { updateHistory: true });
        });
        tab.addEventListener("keydown", (event) => {
            let targetIndex = index;
            if (event.key === "ArrowRight")
                targetIndex = (index + 1) % tabButtons.length;
            else if (event.key === "ArrowLeft")
                targetIndex = (index - 1 + tabButtons.length) % tabButtons.length;
            else if (event.key === "Home")
                targetIndex = 0;
            else if (event.key === "End")
                targetIndex = tabButtons.length - 1;
            else
                return;
            event.preventDefault();
            activateTab(dashboardTabId(tabButtons[targetIndex]?.dataset.tab), { updateHistory: true, focus: true });
        });
    });
    window.addEventListener("hashchange", () => activateTab(tabFromHash()));
    activateTab(tabFromHash());
})();
