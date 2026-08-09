import React from "react";
import { createComponent } from "@lit/react";
import { Notification as EfNotificationElement } from "@refinitiv-ui/elements/notification";

export const EfNotification = createComponent({
    react: React,
    tagName: "ef-notification",
    elementClass: EfNotificationElement,
    events: {
        onDismiss: "dismiss",
        onCollapsed: "collapsed",
    },
});
