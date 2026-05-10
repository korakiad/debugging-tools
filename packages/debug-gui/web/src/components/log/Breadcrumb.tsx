import { EfIcon } from "../../ui";

interface BreadcrumbProps {
    spec: string | null;
    suite?: string | null;
    test?: string | null;
    step: number;
    total: number;
}

function StepDots({ step, total }: { step: number; total: number }) {
    if (total <= 0) return null;
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < total; i++) {
        const filled = i < step;
        cells.push(
            <span
                key={i}
                className="log-breadcrumb-dot"
                data-filled={filled || undefined}
                aria-hidden
            />
        );
    }
    return (
        <div className="log-breadcrumb-dots" aria-label={`step ${step} of ${total}`}>
            {cells}
            <span className="log-breadcrumb-dots-count">
                {step}/{total}
            </span>
        </div>
    );
}

export function Breadcrumb({ spec, suite, test, step, total }: BreadcrumbProps) {
    const parts: React.ReactNode[] = [];
    if (spec) {
        parts.push(<span key="spec" className="log-breadcrumb-spec">{spec}</span>);
    }
    if (suite) {
        parts.push(
            <EfIcon key="sep-suite" icon="right" className="log-breadcrumb-sep" />,
            <span key="suite" className="log-breadcrumb-suite">{suite}</span>
        );
    }
    if (test) {
        parts.push(
            <EfIcon key="sep-test" icon="right" className="log-breadcrumb-sep" />,
            <span key="test" className="log-breadcrumb-test">{test}</span>
        );
    }
    return (
        <nav className="log-breadcrumb" aria-label="current test path">
            <div className="log-breadcrumb-trail">
                {parts.length > 0 ? parts : (
                    <span className="log-breadcrumb-empty">No test selected</span>
                )}
            </div>
            <StepDots step={step} total={total} />
        </nav>
    );
}
