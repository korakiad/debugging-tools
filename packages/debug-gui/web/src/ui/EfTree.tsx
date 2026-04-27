import React from "react";
import { createComponent } from "@lit/react";
import { Tree as EfTreeElement } from "@refinitiv-ui/elements/tree";

export const EfTree = createComponent({
    react: React,
    tagName: "ef-tree",
    elementClass: EfTreeElement,
    events: {
        onValueChanged: "value-changed",
        onExpandedChanged: "expanded-changed",
    },
});
