import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FailureCard } from "./FailureCard";

describe("FailureCard", () => {
    it("renders test, file, and error message", () => {
        render(<FailureCard failure={{ test: "login", file: "a.spec.js:15", error: "not found", stack: "" }} />);
        expect(screen.getByText("login")).toBeInTheDocument();
        expect(screen.getByText(/not found/)).toBeInTheDocument();
        expect(screen.getByText("a.spec.js:15")).toBeInTheDocument();
    });
});
