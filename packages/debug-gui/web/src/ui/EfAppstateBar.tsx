import React from "react";
import { createComponent } from "@lit/react";
import { AppstateBar as EfAppstateBarElement } from "@refinitiv-ui/elements/appstate-bar";

export const EfAppstateBar = createComponent({
    react: React,
    tagName: "ef-appstate-bar",
    elementClass: EfAppstateBarElement,
    events: {
        onClear: "clear",
    },
});
