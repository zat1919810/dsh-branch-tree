//#region dsh-branch-tree host half
/**
 * Branch-tree plugin, node half. Pure UI plugin: the empty apply exists so the
 * package appears in the profile's cordis.yml / Loader as an ordinary entry;
 * the browser half ships via exports["./client"] and is discovered through the
 * package.json `dsh.client` declaration.
 *
 * All branching behavior rides existing Host machinery — `session.fork` plus
 * the durable `parentSession` lineage — so this half owns no state.
 */
/** Host plugin body - no host-side behavior for this UI plugin. */
export function apply() {}
//#endregion
