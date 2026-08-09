import type { ReactNode } from "react";

interface EmptyHeroProps {
    icon?: ReactNode;
    title: string;
    subtitle?: string;
}

export function EmptyHero({ icon, title, subtitle }: EmptyHeroProps) {
    return (
        <div className="empty-hero" role="status" aria-label={title}>
            {icon && (
                <div className="empty-hero-icon" aria-hidden>
                    {icon}
                </div>
            )}
            <h2 className="empty-hero-title">{title}</h2>
            {subtitle && <p className="empty-hero-subtitle">{subtitle}</p>}
        </div>
    );
}
