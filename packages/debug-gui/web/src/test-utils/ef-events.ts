// Helpers for driving refinitiv-ui (Lit) form elements from Vitest tests.
// Native fireEvent.change targets the inner <input> in shadow DOM, which
// jsdom doesn't expose to React's @lit/react listener. Instead, set the
// property directly and dispatch the CustomEvent the component would fire
// after the user commits a change. The dispatch is wrapped in act() so the
// React state update triggered by onValueChanged / onCheckedChanged flushes
// before the next assertion.
import { act } from "@testing-library/react";

export function setEfValue(el: Element, value: string): void {
    act(() => {
        (el as unknown as { value: string }).value = value;
        el.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
    });
}

export function setEfChecked(el: Element, checked: boolean): void {
    act(() => {
        (el as unknown as { checked: boolean }).checked = checked;
        el.dispatchEvent(
            new CustomEvent("checked-changed", { detail: { value: checked } }),
        );
    });
}
