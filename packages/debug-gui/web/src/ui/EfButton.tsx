import React from "react";
import { createComponent } from "@lit/react";
import { Button as EfButtonElement } from "@refinitiv-ui/elements/button";

export const EfButton = createComponent({
    react: React,
    tagName: "ef-button",
    elementClass: EfButtonElement,
    events: {
        onTap: "tap",
        onActiveChanged: "active-changed",
    },
});
