import React from "react";
import { createComponent } from "@lit/react";
import { Panel as EfPanelElement } from "@refinitiv-ui/elements/panel";

export const EfPanel = createComponent({
    react: React,
    tagName: "ef-panel",
    elementClass: EfPanelElement,
    events: {
        onCollapsedChange: "collapsed-changed",
    },
});
