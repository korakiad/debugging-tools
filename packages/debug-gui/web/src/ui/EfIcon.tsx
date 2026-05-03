import React from "react";
import { createComponent } from "@lit/react";
import { Icon as EfIconElement } from "@refinitiv-ui/elements/icon";

export const EfIcon = createComponent({
    react: React,
    tagName: "ef-icon",
    elementClass: EfIconElement,
});
