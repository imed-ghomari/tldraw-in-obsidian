import UserSettingsManager from "src/obsidian/settings/UserSettingsManager";
import { Editor } from "tldraw"

function isLaserScribbleAndKeepDelayAfterStop(item: any, userSettings: UserSettingsManager) {
    return item.scribble.color === 'laser'
        && userSettings.settings.tldrawOptions?.laserKeepDelayAfterStop;
}

export default function monkeyPatchEditorInstance(editor: Editor, userSettings: UserSettingsManager) {
    const scribbles = editor.scribbles as any;

    /**
     * Modified from tldraw package source: packages/editor/src/lib/editor/managers/ScribbleManager.ts
     * 
     * The original {@linkcode editor.scribbles.stop} method hardcodes a maximum 200 millisecond
     * delay before any scribble disappears.
     * 
     * For our purposes, we allow only the laser color to ignore this delay.
     */
    scribbles.stop = function stop(id: string) {
        // In 4.4.0, scribbles are stored in sessions
        const sessions = this.sessions as Map<string, any>;

        for (const session of sessions.values()) {
            const item = session.items.find((i: any) => i.id === id);
            if (item) {
                if (!isLaserScribbleAndKeepDelayAfterStop(item, userSettings)) {
                    item.delayRemaining = Math.min(item.delayRemaining, 200);
                }
                item.scribble.state = "stopping";
                return item;
            }
        }
        throw Error(`Scribble with id ${id} not found`);
    };

    /**
     * Modified from tldraw package source: packages/editor/src/lib/editor/managers/ScribbleManager.ts
     * 
     * We override this method to prevent the laser from being consumed (shrinking) 
     * when it is not moving (active but timeoutMs=0), if the setting is enabled.
     */
    scribbles.tickSelfConsumingItem = function tickSelfConsumingItem(item: any, elapsed: number) {
        const { scribble } = item;
        if (scribble.state === "starting") {
            const { next, prev } = item;
            if (next && next !== prev) {
                item.prev = next;
                scribble.points.push(next);
            }
            if (scribble.points.length > 8) {
                scribble.state = "active";
            }
            return;
        }
        if (item.delayRemaining > 0) {
            item.delayRemaining = Math.max(0, item.delayRemaining - elapsed);
        }
        item.timeoutMs += elapsed;
        if (item.timeoutMs >= 16) {
            item.timeoutMs = 0;
        }
        const { delayRemaining, timeoutMs, prev, next } = item;

        switch (scribble.state) {
            case "active": {
                if (next && next !== prev) {
                    item.prev = next;
                    scribble.points.push(next);
                    if (delayRemaining === 0 && scribble.points.length > 8) {
                        scribble.points.shift();
                    }
                } else {
                    // This is the check we added:
                    if (timeoutMs === 0 && !isLaserScribbleAndKeepDelayAfterStop(item, userSettings)) {
                        if (scribble.points.length > 1) {
                            scribble.points.shift();
                        } else {
                            item.delayRemaining = scribble.delay;
                        }
                    }
                }
                break;
            }
            case "stopping": {
                if (delayRemaining === 0 && timeoutMs === 0) {
                    if (scribble.points.length <= 1) {
                        scribble.points.length = 0;
                        return;
                    }
                    if (scribble.shrink) {
                        scribble.size = Math.max(1, scribble.size * (1 - scribble.shrink));
                    }
                    scribble.points.shift();
                }
                break;
            }
            case "paused": {
                break;
            }
        }
    }
}