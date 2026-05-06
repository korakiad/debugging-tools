import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PromptPanel } from "./PromptPanel";

describe("PromptPanel", () => {
    const baseProps = {
        summary: "Login button not found",
        options: [
            { id: "apply_a", label: "Use [data-test=login]", detail: "found via snapshot" },
            { id: "investigate_b", label: "Inspect modal first" },
        ],
    };

    it("renders summary, options, and option detail", () => {
        render(<PromptPanel {...baseProps} allowFreeText={false} onRespond={() => {}} />);
        expect(screen.getByText("Login button not found")).toBeInTheDocument();
        expect(screen.getByText("Use [data-test=login]")).toBeInTheDocument();
        expect(screen.getByText("found via snapshot")).toBeInTheDocument();
        expect(screen.getByText("Inspect modal first")).toBeInTheDocument();
    });

    it("calls onRespond with chosen option id when option clicked", () => {
        const onRespond = vi.fn();
        render(<PromptPanel {...baseProps} allowFreeText={false} onRespond={onRespond} />);
        fireEvent.click(screen.getByText("Use [data-test=login]"));
        expect(onRespond).toHaveBeenCalledWith({ choice: "apply_a", freeText: null });
    });

    it("does not render textarea when allowFreeText is false", () => {
        render(<PromptPanel {...baseProps} allowFreeText={false} onRespond={() => {}} />);
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("renders textarea + Send when allowFreeText is true", () => {
        const onRespond = vi.fn();
        render(<PromptPanel {...baseProps} allowFreeText={true} onRespond={onRespond} />);
        const ta = screen.getByRole("textbox");
        fireEvent.change(ta, { target: { value: "look at modal" } });
        fireEvent.click(screen.getByText("Send"));
        expect(onRespond).toHaveBeenCalledWith({ choice: null, freeText: "look at modal" });
    });

    it("clicking option with text in box sends both choice and freeText", () => {
        const onRespond = vi.fn();
        render(<PromptPanel {...baseProps} allowFreeText={true} onRespond={onRespond} />);
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "extra context" } });
        fireEvent.click(screen.getByText("Use [data-test=login]"));
        expect(onRespond).toHaveBeenCalledWith({ choice: "apply_a", freeText: "extra context" });
    });

    it("clicking Send is a no-op when no options and textarea empty", () => {
        // Behavioural check: ef-button's `disabled` reflects via Lit's async
        // update cycle (and not as the HTML disabled attribute), so we assert
        // the user-visible effect — Send must not invoke onRespond — instead
        // of inspecting attributes.
        const onRespond = vi.fn();
        render(
            <PromptPanel
                summary="x"
                options={[]}
                allowFreeText={true}
                onRespond={onRespond}
            />,
        );
        fireEvent.click(screen.getByText("Send"));
        expect(onRespond).not.toHaveBeenCalled();
    });

    it("textarea placeholder invites QA to add missing context", () => {
        render(<PromptPanel {...baseProps} allowFreeText={true} onRespond={() => {}} />);
        const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
        expect(ta.placeholder).toMatch(/missing|overlook/i);
    });
});
