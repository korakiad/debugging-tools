import { useMemo } from "react";
import { useStore } from "../state/store";
import { EfPanel } from "../ui";
import { StatusHeader } from "./log/StatusHeader";
import { Breadcrumb } from "./log/Breadcrumb";
import { LogTable } from "./log/LogTable";
import { SelfHealBlock } from "./log/SelfHealBlock";
import { deriveLog } from "./log/deriveLog";

export function LogPanel() {
    const log = useStore((s) => s.mochaLog);
    const sessionState = useStore((s) => s.state);
    const startedAt = useStore((s) => s.runStartedAt);
    const selectedSpec = useStore((s) => s.selectedSpec);
    const selectedNode = useStore((s) => s.selectedNode);
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

    // Breadcrumb — split selectedNode into suite/test parts for the trail.
    // describe → suite, it → test (with its parent describe as the suite).
    const { suiteCrumb, testCrumb } = useMemo(() => {
        if (!selectedNode) return { suiteCrumb: null, testCrumb: null };
        if (selectedNode.kind === "describe") {
            return { suiteCrumb: selectedNode.fullTitle, testCrumb: null };
        }
        // it: the full title is "Suite > Sub > test"; show last as test, rest as suite
        const parts = selectedNode.fullTitle.split(/\s>\s|\s/).filter(Boolean);
        if (parts.length <= 1) return { suiteCrumb: null, testCrumb: selectedNode.fullTitle };
        return {
            suiteCrumb: parts.slice(0, -1).join(" "),
            testCrumb: parts[parts.length - 1],
        };
    }, [selectedNode]);

    return (
        <EfPanel spacing className="log-panel" style={{ display: "block" }}>
            <StatusHeader
                state={sessionState.state}
                startedAt={startedAt}
                step={counts.passed + counts.failed}
                total={counts.totalSteps}
            />
            <Breadcrumb
                spec={selectedSpec}
                suite={suiteCrumb}
                test={testCrumb}
                step={counts.passed + counts.failed}
                total={counts.totalSteps}
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
