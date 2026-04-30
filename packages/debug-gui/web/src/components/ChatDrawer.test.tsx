import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatDrawer } from "./ChatDrawer";
import { useStore } from "../state/store";

describe("ChatDrawer", () => {
    beforeEach(() => {
        useStore.setState({
            chatMessages: [],
            agentThinking: false,
            agentActivity: "",
        });
    });

    it("renders pendingPrompt as an inline assistant turn", () => {
        const { container } = render(
            <ChatDrawer
                onSend={() => {}}
                onAbort={() => {}}
                pendingPrompt={{
                    reqId: "r1",
                    summary: "Login button not found",
                    options: [{ id: "apply_a", label: "Use [data-test=login]" }],
                    allowFreeText: false,
                }}
                onPromptRespond={() => {}}
            />,
        );
        // Assert the summary lives inside the prompt block (not just anywhere
        // in the drawer) so future changes that drop PromptPanel still fail.
        const summary = container.querySelector(".prompt-summary");
        expect(summary?.textContent).toBe("Login button not found");
        expect(screen.getByText("Use [data-test=login]")).toBeInTheDocument();
    });

    it("forwards option clicks through onPromptRespond", () => {
        const onPromptRespond = vi.fn();
        render(
            <ChatDrawer
                onSend={() => {}}
                onAbort={() => {}}
                pendingPrompt={{
                    reqId: "r1",
                    summary: "Pick one",
                    options: [{ id: "apply_a", label: "Apply A" }],
                    allowFreeText: false,
                }}
                onPromptRespond={onPromptRespond}
            />,
        );
        fireEvent.click(screen.getByText("Apply A"));
        expect(onPromptRespond).toHaveBeenCalledWith({ choice: "apply_a", freeText: null });
    });

    it("does not render PromptPanel when pendingPrompt is null", () => {
        render(
            <ChatDrawer
                onSend={() => {}}
                onAbort={() => {}}
                pendingPrompt={null}
                onPromptRespond={() => {}}
            />,
        );
        // No "assistant:" label — chatMessages is empty and no prompt is pending.
        expect(screen.queryByText("assistant:")).not.toBeInTheDocument();
    });
});
