import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyHero } from "./EmptyHero";

describe("EmptyHero", () => {
    it("renders the title and exposes it as the status region's aria-label", () => {
        render(<EmptyHero title="Pick a test" />);
        const region = screen.getByRole("status", { name: "Pick a test" });
        expect(region).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Pick a test" })).toBeInTheDocument();
    });

    it("renders the subtitle when provided", () => {
        render(<EmptyHero title="t" subtitle="Choose from the tree on the left." />);
        expect(screen.getByText(/choose from the tree/i)).toBeInTheDocument();
    });

    it("renders the icon slot when provided and hides it from a11y", () => {
        render(<EmptyHero title="t" icon={<svg data-testid="hero-icon" />} />);
        const icon = screen.getByTestId("hero-icon");
        expect(icon).toBeInTheDocument();
        expect(icon.parentElement).toHaveAttribute("aria-hidden");
    });
});
