import { useMemo } from "react";
import { useStore, type SuiteNode } from "../state/store";
import { EfPanel } from "../ui";
import { findNode } from "../lib/findNode";
import { StatusHeader } from "./log/StatusHeader";
import { Breadcrumb } from "./log/Breadcrumb";
import { LogTable } from "./log/LogTable";
import { SelfHealBlock } from "./log/SelfHealBlock";
import { deriveLog } from "./log/deriveLog";

// Count `it` leaves under a list of nodes. Drives the STEP denominator —
// the plan total of test cases under the current selection, known up
// front from the parsed suite tree.
function countTests(nodes: SuiteNode[]): number {
    const stack: SuiteNode[] = [...nodes];
    let n = 0;
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.kind === "it") n += 1;
        else for (const child of node.children) stack.push(child);
    }
    return n;
}

export function LogPanel() {
    const log = useStore((s) => s.mochaLog);
    const sessionState = useStore((s) => s.state);
    const startedAt = useStore((s) => s.runStartedAt);
    const selectedSpec = useStore((s) => s.selectedSpec);
    const selectedNode = useStore((s) => s.selectedNode);
    const suiteTrees = useStore((s) => s.suiteTrees);
    const pendingDiff = useStore((s) => s.pendingDiff);

    const { rows, counts } = useMemo(
        () =>
            deriveLog({
                log,
                runStartedAt: startedAt,
                currentFailure: sessionState.currentFailure,
                pendingDiff,
            }),
        [log, startedAt, sessionState.currentFailure, pendingDiff]
    );

    const truncated = log.length >= 500;

    // Breadcrumb — pull suite (parent describe) and test (leaf title)
    // from the parsed suite tree so the trail matches the actual nesting
    // rather than guessing at the space-joined `fullTitle`. Falls back to
    // showing `fullTitle` verbatim when the tree hasn't been cached yet.
    const { suiteCrumb, testCrumb } = useMemo(() => {
        if (!selectedNode) return { suiteCrumb: null, testCrumb: null };
        if (selectedNode.kind === "describe") {
            return { suiteCrumb: selectedNode.fullTitle, testCrumb: null };
        }
        const tree = selectedSpec ? suiteTrees[selectedSpec] : undefined;
        const node = findNode(tree, selectedNode);
        if (!node) {
            return { suiteCrumb: null, testCrumb: selectedNode.fullTitle };
        }
        // parseSuite builds `fullTitle = parentFullTitle + " " + title`, so
        // the parent's fullTitle is the leaf's fullTitle minus title (and
        // the joining space). Length equality means the `it` is at the
        // file root with no parent describe.
        const parentLen = node.fullTitle.length - node.title.length - 1;
        const parentTitle = parentLen > 0 ? node.fullTitle.slice(0, parentLen) : null;
        return { suiteCrumb: parentTitle, testCrumb: node.title };
    }, [selectedNode, selectedSpec, suiteTrees]);

    // STEP denominator — planned tests under the current selection, NOT
    // `passed + failed` (which always equals `step`, leaving the meter
    // perpetually at n/n). When no spec is selected or the tree isn't
    // cached yet, falls back to 0 which Breadcrumb/StatusHeader render
    // as a dash.
    const plannedTotal = useMemo(() => {
        const tree = selectedSpec ? suiteTrees[selectedSpec] : undefined;
        if (!tree) return 0;
        if (!selectedNode) return countTests(tree.children);
        const node = findNode(tree, selectedNode);
        if (!node) return 0;
        if (node.kind === "it") return 1;
        return countTests(node.children);
    }, [selectedSpec, selectedNode, suiteTrees]);

    const stepCount = counts.passed + counts.failed;

    return (
        <EfPanel spacing className="log-panel" style={{ display: "block" }}>
            <StatusHeader
                state={sessionState.state}
                startedAt={startedAt}
                step={stepCount}
                total={plannedTotal}
            />
            <Breadcrumb
                spec={selectedSpec}
                suite={suiteCrumb}
                test={testCrumb}
                step={stepCount}
                total={plannedTotal}
            />
            <LogTable
                rows={rows}
                truncated={truncated}
                onSelfHealRow={(row) =>
                    row.heal ? (
                        <SelfHealBlock
                            strategy={row.heal.strategy}
                            confidence={row.heal.confidence}
                            durationMs={row.heal.durationMs}
                            oldCode={row.heal.oldCode}
                            newCode={row.heal.newCode}
                            filePath={row.heal.filePath}
                        />
                    ) : null
                }
            />
        </EfPanel>
    );
}
