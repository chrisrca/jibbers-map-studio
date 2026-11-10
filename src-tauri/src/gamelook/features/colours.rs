//! How the game colours its own features, as read in it (the link's renderer list, self-test `gamecolours`: each
//! coloured feature placed in each of its colours and played). Its shader (Custom/MapObject) turns a part's paint
//! round the colour wheel by the part's `_HueShift`, in linear light; only some parts are turned (a rail's bar, not its
//! posts), and black is another material ("Curve Tube Black"). colours.json has, by feature and the game's name for
//! a part's mesh, each colour's [hue shift, brightness (when not 1), material (when not the prefab's)]; a part not
//! in it is drawn as the prefab has it whatever the colour.

use super::*;

type Table = HashMap<String, HashMap<String, HashMap<String, Vec<serde_json::Value>>>>;

fn table() -> &'static Table {
    static T: std::sync::LazyLock<Table> = std::sync::LazyLock::new(|| serde_json::from_str(include_str!("colours.json")).expect("colours.json"));
    &T
}

/// How the game draws one part in one colour.
#[derive(Debug, PartialEq)]
pub(crate) struct GamePaint {
    pub(crate) hue: f32,
    pub(crate) brightness: Option<f32>,
    /// another material in place of the prefab's (by the game's name for it)
    pub(crate) material: Option<String>,
}

/// What the game does to a feature's part (by its mesh's name) in a colour: Some(None) leaves it as the prefab has
/// it, Some(paint) colours it; None when the game's colours for the feature aren't known (a colour it doesn't have).
pub(crate) fn game_paint(feature: &str, mesh: &str, colour: &str) -> Option<Option<GamePaint>> {
    let parts = table().get(feature)?;
    let Some(colours) = parts.get(mesh) else {
        // (a colour the feature has: its other parts are coloured in it)
        return parts.values().any(|c| c.contains_key(colour)).then_some(None);
    };
    let v = colours.get(colour)?;
    Some(Some(GamePaint {
        hue: v.first().and_then(|h| h.as_f64()).unwrap_or(0.0) as f32,
        brightness: v.get(1).and_then(|b| b.as_f64()).map(|b| b as f32),
        material: v.get(2).and_then(|m| m.as_str()).map(str::to_string),
    }))
}

/// The materials the game swaps in for a colour (its blacks): read with the look (gamelook/mod.rs).
pub(crate) fn swapped_materials() -> Vec<String> {
    let mut out: Vec<String> = table().values().flat_map(|p| p.values()).flat_map(|c| c.values()).filter_map(|v| v.get(2).and_then(|m| m.as_str()).map(str::to_string)).collect();
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_games_colours_as_read_in_it() {
        // a rail's bar turned, its posts not
        assert_eq!(game_paint("rail_long", "Cylinder.023", "red"), Some(Some(GamePaint { hue: 0.4, brightness: None, material: None })));
        assert_eq!(game_paint("rail_long", "Cylinder.006", "red"), Some(None));
        // black: another material
        assert_eq!(game_paint("curve_tube", "curve tube l", "black").unwrap().unwrap().material.as_deref(), Some("Curve Tube Black"));
        // brightness kept with it
        assert_eq!(game_paint("tube_long", "Cylinder.016", "green").unwrap().unwrap().brightness, Some(2.0));
        // a colour the game hasn't for it, a feature it hasn't coloured
        assert_eq!(game_paint("rail_long", "Cylinder.023", "white"), None);
        assert_eq!(game_paint("rail_long", "Cylinder.006", "white"), None);
        assert_eq!(game_paint("no_such", "x", "red"), None);
        assert!(swapped_materials().contains(&"TopSign_Black".to_string()));
    }
}
