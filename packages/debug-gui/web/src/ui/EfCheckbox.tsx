import React from "react";
import { createComponent } from "@lit/react";
import { Checkbox as EfCheckboxElement } from "@refinitiv-ui/elements/checkbox";

export const EfCheckbox = createComponent({
    react: React,
    tagName: "ef-checkbox",
    elementClass: EfCheckboxElement,
    events: {
        onCheckedChanged: "checked-changed",
    },
});
