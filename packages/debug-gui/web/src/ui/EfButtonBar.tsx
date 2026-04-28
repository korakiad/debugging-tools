import React from "react";
import { createComponent } from "@lit/react";
import { ButtonBar as EfButtonBarElement } from "@refinitiv-ui/elements/button-bar";

export const EfButtonBar = createComponent({
    react: React,
    tagName: "ef-button-bar",
    elementClass: EfButtonBarElement,
    events: {},
});
