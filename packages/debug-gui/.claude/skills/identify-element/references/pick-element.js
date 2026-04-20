async (page) => {
    // 1. Enter pick mode — blocks until QA clicks an element
    const locator = await page.pickLocator();

    // 2. Get raw selector (includes frame path with >> internal:control=enter-frame >>)
    const rawSelector = locator._selector || '';

    // 3. Extract element attributes
    const element = await locator.evaluate(el => {
        const data = {};
        const aria = {};
        for (const attr of el.attributes) {
            if (attr.name.startsWith('data-'))
                data[attr.name.slice(5)] = attr.value;
            else if (attr.name.startsWith('aria-'))
                aria[attr.name.slice(5)] = attr.value;
        }
        return {
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            name: el.getAttribute('name') || '',
            type: el.getAttribute('type') || '',
            classes: [...el.classList],
            placeholder: el.getAttribute('placeholder') || '',
            data,
            aria: { ...aria, role: el.getAttribute('role') || '' },
            text: el.textContent?.trim().substring(0, 200) || ''
        };
    });

    // 4. Parse frame chain from raw selector
    const FRAME_SEP = ' >> internal:control=enter-frame >> ';
    const parts = rawSelector.split(FRAME_SEP);
    const frameSelectors = parts.slice(0, -1);

    // 5. Extract iframe attributes for each frame in chain
    const frames = [];
    let context = page;
    for (const fs of frameSelectors) {
        try {
            const attrs = await context.locator(fs).evaluate(el => ({
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                name: el.getAttribute('name') || '',
                src: el.getAttribute('src') || '',
                classes: [...el.classList]
            }));
            frames.push(attrs);
            context = context.frameLocator(fs);
        } catch {
            frames.push({ selector: fs });
        }
    }

    return { element, frames, playwrightLocator: locator.toString() };
}
