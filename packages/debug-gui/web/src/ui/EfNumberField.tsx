import React from "react";
import { createComponent } from "@lit/react";
import { NumberField as EfNumberFieldElement } from "@refinitiv-ui/elements/number-field";

export const EfNumberField = createComponent({
    react: React,
    tagName: "ef-number-field",
    elementClass: EfNumberFieldElement,
    events: {
        onValueChanged: "value-changed",
        onErrorChanged: "error-changed",
    },
});
