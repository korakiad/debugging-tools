import React from "react";
import { createComponent } from "@lit/react";
import { TextField as EfTextFieldElement } from "@refinitiv-ui/elements/text-field";

export const EfTextField = createComponent({
    react: React,
    tagName: "ef-text-field",
    elementClass: EfTextFieldElement,
    events: {
        onValueChanged: "value-changed",
        onErrorChanged: "error-changed",
    },
});
