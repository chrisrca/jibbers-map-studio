//! Walking the game's Unity scene: a game object's components and children, its names, its lower levels of detail, its
//! transform; a lift's templates.

use super::*;

/// A lift prefab's templates (its base and top stations, its mast), by part: none for anything else.
pub(crate) fn lift_templates(g: &Game, root: At) -> Result<Vec<(&'static str, At)>> {
    let go = g.read(root)?;
    let Some(t) = component(g, root, &go, TRANSFORM) else { return Ok(vec![]) };
    let mut out = vec![];
    for c in children(g, t, &g.read(t)?) {
        let name = g.read(c)?.get("m_Name").s().to_string();
        if let Some((part, _)) = LIFT_PARTS.iter().find(|(_, n)| *n == name) {
            out.push((*part, c));
        }
    }
    // (a lift has both stations at least)
    Ok(if out.len() >= 2 { out } else { vec![] })
}

/// A GameObject's component of a class (by what the reference points at).
pub(crate) fn component(g: &Game, go_at: At, go: &V, class: i32) -> Option<At> {
    go.get("m_Component").arr().iter().filter_map(|c| g.resolve(go_at.file, c.get("component").pptr())).find(|&at| g.class_of(at) == Some(class))
}

/// The children of a GameObject (its Transform's), as GameObjects.
pub(crate) fn children(g: &Game, t_at: At, t: &V) -> Vec<At> {
    t.get("m_Children").arr().iter().filter_map(|c| g.resolve(t_at.file, c.pptr())).filter_map(|ct| g.read(ct).ok().and_then(|tv| g.resolve(ct.file, tv.get("m_GameObject").pptr()))).collect()
}

pub(crate) fn all_names(g: &Game, go_at: At, out: &mut Vec<String>) -> Result<()> {
    let go = g.read(go_at)?;
    out.push(go.get("m_Name").s().to_string());
    if let Some(t) = component(g, go_at, &go, TRANSFORM) {
        for c in children(g, t, &g.read(t)?) {
            all_names(g, c, out)?;
        }
    }
    Ok(())
}

/// The renderers on a LOD group's levels after the first, anywhere under a GameObject.
pub(crate) fn lower_lods(g: &Game, go_at: At, out: &mut HashSet<At>) -> Result<()> {
    let go = g.read(go_at)?;
    if let Some(lg) = component(g, go_at, &go, LOD_GROUP) {
        for lod in g.read(lg)?.get("m_LODs").arr().iter().skip(1) {
            for r in lod.get("renderers").arr() {
                if let Some(at) = g.resolve(lg.file, r.get("renderer").pptr()) {
                    out.insert(at);
                }
            }
        }
    }
    if let Some(t) = component(g, go_at, &go, TRANSFORM) {
        for c in children(g, t, &g.read(t)?) {
            lower_lods(g, c, out)?;
        }
    }
    Ok(())
}

/// A transform's local matrix (translate * rotate * scale), row-major 4x4.
pub(crate) fn trs(t: &V) -> [[f64; 4]; 4] {
    let (p, q, s) = (t.get("m_LocalPosition"), t.get("m_LocalRotation"), t.get("m_LocalScale"));
    let (x, y, z, w) = (q.get("x").f(), q.get("y").f(), q.get("z").f(), q.get("w").f());
    let r = [
        [1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y - z * w), 2.0 * (x * z + y * w)],
        [2.0 * (x * y + z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z - x * w)],
        [2.0 * (x * z - y * w), 2.0 * (y * z + x * w), 1.0 - 2.0 * (x * x + y * y)],
    ];
    let sc = [s.get("x").f(), s.get("y").f(), s.get("z").f()];
    let mut m = [[0.0; 4]; 4];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = r[i][j] * sc[j];
        }
    }
    m[0][3] = p.get("x").f();
    m[1][3] = p.get("y").f();
    m[2][3] = p.get("z").f();
    m[3][3] = 1.0;
    m
}

pub(crate) fn mul(a: &[[f64; 4]; 4], b: &[[f64; 4]; 4]) -> [[f64; 4]; 4] {
    let mut m = [[0.0; 4]; 4];
    for i in 0..4 {
        for j in 0..4 {
            m[i][j] = (0..4).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    m
}

pub(crate) const IDENTITY: [[f64; 4]; 4] = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]];
