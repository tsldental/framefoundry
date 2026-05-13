import { useMemo, useState } from "react";
import type { Frame, JsonValue, SessionSummary } from "../types";
import { formatTimestamp } from "../utils";

interface FrameTimelineProps {
  sessionId: string | null;
  session: SessionSummary | null;
  frames: Frame[];
  isLoading: boolean;
  selectedFrameId: number | null;
  onSelectFrame: (frame: Frame) => void;
  onForkFromFrame: (frame: Frame) => void;
}

interface MetricProps {
  label: string;
  value: number;
}

interface TimelineEntry {
  frame: Frame;
  toolResult?: Frame;
}

export function FrameTimeline({
  sessionId,
  session,
  frames,
  isLoading,
  selectedFrameId,
  onSelectFrame,
  onForkFromFrame,
}: FrameTimelineProps) {
  const replayFrames = useMemo(
    () => frames.filter((frame) => isReplayFrame(frame.metadata)),
    [frames],
  );
  const liveFrames = useMemo(
    () => frames.filter((frame) => !isReplayFrame(frame.metadata)),
    [frames],
  );

  const framePairs = useMemo(() => buildFramePairs(frames), [frames]);
  const timelineDiagnostics = useMemo(() => analyzeTimelineEntries(framePairs), [framePairs]);
  const selectedFrame = frames.find((frame) => frame.id === selectedFrameId) ?? null;

  return (
    <main className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Active Session</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            {session ? session.headline : sessionId ?? "Select a session"}
          </h2>
          {session && sessionId ? (
            <p className="mt-1 font-mono text-xs text-slate-500" title={sessionId}>
              …{sessionId.slice(-12)}
            </p>
          ) : null}
        </div>
        <div className="flex gap-3 text-xs text-slate-300">
          <Metric label="Frames" value={frames.length} />
          <Metric label="Live" value={liveFrames.length} />
          <Metric label="Replay" value={replayFrames.length} />
          <Metric label="Errors" value={timelineDiagnostics.errorCount} />
        </div>
      </div>

      {session ? <SnapshotStrip session={session} /> : null}

      {!sessionId ? (
        <EmptyState message="Choose a session to inspect its recorded timeline." />
      ) : isLoading ? (
        <EmptyState message="Loading cognitive snapshot..." />
      ) : frames.length === 0 ? (
        <EmptyState message="This session has no frames yet." />
      ) : (
        <div className="space-y-4">
          {framePairs.map(({ frame, toolResult }) => (
            <FrameCard
              key={frame.id}
              frame={frame}
              toolResult={toolResult}
              selectedFrameId={selectedFrameId}
              hasError={timelineDiagnostics.errorFrameIds.has(frame.id)}
              recommendedBranchPoint={timelineDiagnostics.branchPointFrameIds.has(frame.id)}
              onSelectFrame={onSelectFrame}
            />
          ))}
        </div>
      )}

      {selectedFrame ? (
        <div className="pointer-events-none sticky bottom-4 mt-6 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-4 rounded-2xl border border-cyan-400/30 bg-slate-950/95 px-5 py-3 shadow-2xl shadow-cyan-950/20 backdrop-blur">
            <div>
              <div className="text-[11px] uppercase tracking-[0.25em] text-cyan-300">
                Selected Frame
              </div>
              <div className="mt-1 text-sm text-white">
                #{selectedFrame.sequence} {selectedFrame.frameType}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onForkFromFrame(selectedFrame)}
              className="rounded-full border border-cyan-400/40 bg-cyan-400/15 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-400/25"
            >
              Fork from here
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function SnapshotStrip({ session }: { session: SessionSummary }) {
  return (
    <section className="mb-6 grid gap-3 xl:grid-cols-3">
      <SnapshotCard label="Opening Snapshot" value={session.headline} accent="cyan" />
      <SnapshotCard label="Latest Checkpoint" value={session.latestSummary} accent="emerald" />
      <SnapshotCard
        label="Branch Context"
        value={
          session.branchRootFrameId
            ? `Forked from frame #${session.branchRootFrameId} with ${session.frameCount} recorded frames across this path.`
            : `Root session with ${session.frameCount} recorded frames and ${session.childCount} downstream branch${session.childCount === 1 ? "" : "es"}.`
        }
        accent="violet"
      />
    </section>
  );
}

function FrameCard({
  frame,
  toolResult,
  selectedFrameId,
  hasError,
  recommendedBranchPoint,
  onSelectFrame,
}: {
  frame: Frame;
  toolResult?: Frame;
  selectedFrameId: number | null;
  hasError: boolean;
  recommendedBranchPoint: boolean;
  onSelectFrame: (frame: Frame) => void;
}) {
  const [showRawJson, setShowRawJson] = useState(false);
  const isSelected = selectedFrameId === frame.id;
  const isToolResultSelected = toolResult ? selectedFrameId === toolResult.id : false;
  const frameContent = formatPrimaryContent(frame);
  const frameTags = classifyFrameTags(frame, frameContent);

  if (frame.frameType === "tool_call") {
    const toolArgsSummary = `args=${truncateString(JSON.stringify(extractValueField(frame.content, "args")))}`;
    const toolArgsTooltip = JSON.stringify(extractValueField(frame.content, "args"), null, 2);
    const toolResultTooltip = toolResult
      ? JSON.stringify(extractValueField(toolResult.content, "result"), null, 2)
      : undefined;

    return (
      <div className="flex justify-center">
        <article
          onClick={() => onSelectFrame(frame)}
          title={toolArgsTooltip}
          className={`w-full max-w-3xl cursor-pointer rounded-3xl border bg-slate-950/80 p-5 text-center shadow-lg shadow-slate-950/30 transition ${
            hasError
              ? "border-rose-500/40 bg-rose-500/6 shadow-rose-950/20"
              : isSelected
                ? "border-cyan-400 shadow-cyan-950/20"
                : "border-amber-500/20"
          }`}
        >
          <FrameHeader frame={frame} showRawJson={showRawJson} onToggleRawJson={setShowRawJson} />
          <FrameTagRow
            tags={augmentTags(frameTags, {
              hasError,
              recommendedBranchPoint,
            })}
          />
          <div className="flex items-center justify-center gap-3 text-sm text-amber-100">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-400/30 bg-amber-400/10 text-lg">
              🔧
            </span>
            <div
              className="rounded-2xl border border-amber-500/20 bg-slate-900/80 px-4 py-3 font-mono text-left text-[13px] leading-6 text-amber-100"
              title={toolArgsTooltip}
            >
              <div className="font-semibold">{frame.toolName ?? "tool_call"}</div>
              <div className="mt-1 text-slate-300">{toolArgsSummary}</div>
            </div>
          </div>

          {toolResult ? (
            <div
              onClick={(event) => {
                event.stopPropagation();
                onSelectFrame(toolResult);
              }}
                className={`mt-4 ml-auto mr-auto max-w-2xl cursor-pointer rounded-2xl border bg-slate-900/90 p-4 text-left transition ${
                  hasError
                    ? "border-rose-500/40 bg-rose-500/8"
                    : isToolResultSelected
                      ? "border-cyan-400 shadow-lg shadow-cyan-950/20"
                      : "border-slate-800"
                }`}
                title={toolResultTooltip}
              >
              <div
                className={`mb-2 text-xs font-semibold uppercase tracking-[0.25em] ${
                  hasError ? "text-rose-300" : "text-emerald-300"
                }`}
              >
                {hasError ? "Tool Result Error" : "Tool Result"}
              </div>
              <div
                className={`rounded-xl px-4 py-3 text-sm text-slate-200 ${
                  hasError
                    ? "border border-rose-500/30 bg-rose-500/8"
                    : "border border-emerald-500/20 bg-emerald-500/5"
                }`}
                title={toolResultTooltip}
              >
                {truncateString(JSON.stringify(extractValueField(toolResult.content, "result")), 220)}
              </div>
              <FrameFooter frame={toolResult} showRawJson={showRawJson} />
            </div>
          ) : null}

          {showRawJson ? <RawJsonPanels frame={frame} nestedFrame={toolResult} /> : null}
        </article>
      </div>
    );
  }

  const alignmentClass = frame.role === "assistant" ? "border-emerald-500/30" : "border-sky-500/30";
  const accentClass =
    frame.role === "assistant"
      ? "bg-emerald-500/5 shadow-emerald-950/10"
      : "bg-sky-500/5 shadow-sky-950/10";

  return (
    <article
      onClick={() => onSelectFrame(frame)}
      title={frameContent}
      className={`cursor-pointer rounded-3xl border bg-slate-950/80 p-5 shadow-lg transition ${
        hasError ? "border-rose-500/40 bg-rose-500/6 shadow-rose-950/20" : `${alignmentClass} ${accentClass}`
      } ${
        isSelected ? "border-cyan-400 shadow-cyan-950/20" : ""
      }`}
    >
      <FrameHeader frame={frame} showRawJson={showRawJson} onToggleRawJson={setShowRawJson} />
      <FrameTagRow
        tags={augmentTags(frameTags, {
          hasError,
          recommendedBranchPoint,
        })}
      />
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
        <pre
          className="overflow-x-auto whitespace-pre-wrap break-words text-sm leading-6 text-slate-100"
          title={frameContent}
        >
          {frameContent}
        </pre>
      </div>
      {showRawJson ? <RawJsonPanels frame={frame} /> : null}
    </article>
  );
}

function FrameHeader({
  frame,
  showRawJson,
  onToggleRawJson,
}: {
  frame: Frame;
  showRawJson: boolean;
  onToggleRawJson: (value: boolean) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200">
        #{frame.sequence}
      </span>
      <FrameBadge type={frame.frameType} />
      {frame.role ? (
        <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
          {frame.role}
        </span>
      ) : null}
      {frame.toolName ? (
        <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
          {frame.toolName}
        </span>
      ) : null}
      {isReplayFrame(frame.metadata) ? (
        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">
          replay
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => onToggleRawJson(!showRawJson)}
        className="ml-auto rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-white"
      >
        {showRawJson ? "Hide Raw JSON" : "Raw JSON"}
      </button>
      <span className="text-xs text-slate-500" title={frame.createdAt}>
        {formatTimestamp(frame.createdAt)}
      </span>
    </div>
  );
}

function FrameFooter({ frame, showRawJson }: { frame: Frame; showRawJson: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span title={frame.createdAt}>{formatTimestamp(frame.createdAt)}</span>
      {showRawJson ? <span>included in raw view</span> : null}
    </div>
  );
}

function FrameTagRow({ tags }: { tags: TimelineTag[] }) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span
          key={`${tag.label}-${tag.tone}`}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${tagClassName(tag.tone)}`}
        >
          {tag.label}
        </span>
      ))}
    </div>
  );
}

function RawJsonPanels({ frame, nestedFrame }: { frame: Frame; nestedFrame?: Frame }) {
  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <JsonPanel title={`Frame ${frame.sequence} metadata_json`} value={frame.metadata} />
      {nestedFrame ? (
        <JsonPanel title={`Frame ${nestedFrame.sequence} metadata_json`} value={nestedFrame.metadata} />
      ) : (
        <JsonPanel title={`Frame ${frame.sequence} content_json`} value={frame.content} />
      )}
    </div>
  );
}

function JsonPanel({ title, value }: { title: string; value: JsonValue }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-left">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
        {title}
      </h3>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-right">
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function SnapshotCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "cyan" | "emerald" | "violet";
}) {
  const accentClass =
    accent === "cyan"
      ? "border-cyan-400/20 bg-cyan-400/5"
      : accent === "emerald"
        ? "border-emerald-400/20 bg-emerald-400/5"
        : "border-violet-400/20 bg-violet-400/5";

  const labelClass =
    accent === "cyan"
      ? "text-cyan-300"
      : accent === "emerald"
        ? "text-emerald-300"
        : "text-violet-300";

  return (
    <div className={`rounded-2xl border p-4 ${accentClass}`} title={value}>
      <div className={`text-[11px] uppercase tracking-[0.24em] ${labelClass}`}>{label}</div>
      <div className="mt-2 text-sm leading-6 text-slate-100">{value}</div>
    </div>
  );
}

interface TimelineTag {
  label: string;
  tone: "cyan" | "emerald" | "amber" | "violet" | "rose" | "slate";
}

interface TimelineDiagnostics {
  errorFrameIds: Set<number>;
  branchPointFrameIds: Set<number>;
  errorCount: number;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-950/40 p-8 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}

function FrameBadge({ type }: { type: Frame["frameType"] }) {
  const badgeClass =
    type === "llm_turn"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
      : type === "tool_call"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : type === "tool_result"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          : "border-slate-700 bg-slate-800 text-slate-200";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${badgeClass}`}>
      {type}
    </span>
  );
}

function buildFramePairs(frames: Frame[]): TimelineEntry[] {
  const toolResultIds = new Set<number>();
  const toolResultsByCallId = new Map<string, Frame>();

  for (const frame of frames) {
    if (frame.frameType === "tool_result" && frame.toolCallId) {
      toolResultsByCallId.set(frame.toolCallId, frame);
    }
  }

  return frames.flatMap((frame) => {
    if (toolResultIds.has(frame.id)) {
      return [];
    }

    if (frame.frameType === "tool_call" && frame.toolCallId) {
      const toolResult = toolResultsByCallId.get(frame.toolCallId);

      if (toolResult) {
        toolResultIds.add(toolResult.id);
      }

      return [{ frame, toolResult }];
    }

    if (frame.frameType === "tool_result") {
      return [];
    }

    return [{ frame }];
  });
}

function formatPrimaryContent(frame: Frame): string {
  if (frame.frameType === "llm_turn") {
    const content = extractStringField(frame.content, "content").trim();

    if (content.length > 0) {
      return content;
    }

    return describeEmptyLlmTurn(frame);
  }

  return JSON.stringify(frame.content, null, 2);
}

function describeEmptyLlmTurn(frame: Frame): string {
  if (frame.role === "assistant") {
    return "This assistant turn did not record any visible text. It is usually a placeholder event before or after tool activity.";
  }

  if (frame.role === "user") {
    return "This user turn has no visible text recorded.";
  }

  return "This language-model turn has no visible text recorded.";
}

function classifyFrameTags(frame: Frame, frameContent: string): TimelineTag[] {
  const tags: TimelineTag[] = [];
  const lowerContent = frameContent.toLowerCase();

  if (isForkFrame(frame)) {
    tags.push({ label: "Fork Point", tone: "violet" });
  }

  if (frame.frameType === "tool_call") {
    tags.push({ label: "Tool", tone: "amber" });
    tags.push({ label: "Action", tone: "cyan" });
    return tags;
  }

  if (frame.frameType === "tool_result") {
    tags.push({ label: "Result", tone: "emerald" });
    return tags;
  }

  if (frame.frameType === "system_event") {
    tags.push({ label: "System", tone: "slate" });
    return tags;
  }

  if (frame.role === "assistant") {
    if (
      lowerContent.includes("plan") ||
      lowerContent.includes("first i") ||
      lowerContent.includes("i'll") ||
      lowerContent.includes("i will") ||
      lowerContent.includes("step 1") ||
      lowerContent.includes("here's the plan")
    ) {
      tags.push({ label: "Plan", tone: "violet" });
    }

    tags.push({ label: "Action", tone: "cyan" });
    return tags;
  }

  if (frame.role === "user") {
    tags.push({ label: "Request", tone: "slate" });
  }

  return tags;
}

function augmentTags(
  tags: TimelineTag[],
  options: {
    hasError: boolean;
    recommendedBranchPoint: boolean;
  },
): TimelineTag[] {
  const nextTags = [...tags];

  if (options.hasError) {
    nextTags.unshift({ label: "Error", tone: "rose" });
  }

  if (options.recommendedBranchPoint) {
    nextTags.unshift({ label: "Branch Here", tone: "violet" });
  }

  return nextTags;
}

function analyzeTimelineEntries(entries: TimelineEntry[]): TimelineDiagnostics {
  const errorFrameIds = new Set<number>();
  const branchPointFrameIds = new Set<number>();

  entries.forEach((entry, index) => {
    if (!entryLooksLikeError(entry)) {
      return;
    }

    errorFrameIds.add(entry.frame.id);

    if (entry.toolResult) {
      errorFrameIds.add(entry.toolResult.id);
    }

    const previousEntry = index > 0 ? entries[index - 1] : null;
    if (previousEntry) {
      branchPointFrameIds.add(previousEntry.frame.id);
    }
  });

  return {
    errorFrameIds,
    branchPointFrameIds,
    errorCount: errorFrameIds.size,
  };
}

function entryLooksLikeError(entry: TimelineEntry): boolean {
  return frameLooksLikeError(entry.frame) || (entry.toolResult ? frameLooksLikeError(entry.toolResult) : false);
}

function frameLooksLikeError(frame: Frame): boolean {
  const haystack = [
    frame.frameType,
    frame.role ?? "",
    frame.toolName ?? "",
    stringifyForSearch(frame.content),
    stringifyForSearch(frame.metadata),
  ]
    .join("\n")
    .toLowerCase();

  return (
    haystack.includes("error") ||
    haystack.includes("exception") ||
    haystack.includes("traceback") ||
    haystack.includes("failed") ||
    haystack.includes("failure") ||
    haystack.includes("enoent") ||
    haystack.includes("eacces") ||
    haystack.includes("not found") ||
    haystack.includes("timed out") ||
    haystack.includes("exit code 1") ||
    haystack.includes("exit code 2") ||
    haystack.includes("status\":500") ||
    haystack.includes("\"error\":")
  );
}

function stringifyForSearch(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function isForkFrame(frame: Frame): boolean {
  if (typeof frame.metadata !== "object" || frame.metadata === null || Array.isArray(frame.metadata)) {
    return false;
  }

  return frame.metadata.is_fork === true || frame.branchRootFrameId !== null;
}

function tagClassName(tone: TimelineTag["tone"]): string {
  switch (tone) {
    case "cyan":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
    case "emerald":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "amber":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "violet":
      return "border-violet-500/30 bg-violet-500/10 text-violet-200";
    case "rose":
      return "border-rose-500/30 bg-rose-500/10 text-rose-200";
    default:
      return "border-slate-700 bg-slate-800 text-slate-200";
  }
}

function extractStringField(value: JsonValue, fieldName: string): string {
  const fieldValue = extractValueField(value, fieldName);
  return typeof fieldValue === "string" ? fieldValue : JSON.stringify(fieldValue, null, 2);
}

function extractValueField(value: JsonValue, fieldName: string): JsonValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  return value[fieldName] ?? null;
}

function truncateString(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function isReplayFrame(metadata: JsonValue): boolean {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return false;
  }

  return metadata.is_replay === true;
}
