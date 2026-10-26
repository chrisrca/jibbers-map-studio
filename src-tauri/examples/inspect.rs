//! Prints what's in a map: chunks (size, detail, masks), objects, custom pieces, materials and textures, trees.
//! `cargo run --release --example inspect -- <map.jbrmap>`

use std::collections::BTreeMap;

fn main() {
    let path = std::env::args().nth(1).expect("a .jbrmap");
    let m = jibbers_studio_lib::jbrmap::load(&path).expect("read");
    println!("{} ({}) version {}", m.name, m.id, m.version);
    for c in &m.chunks {
        let res = c.heightmap_resolution;
        let mask = |t: &Option<jibbers_studio_lib::jbrmap::TextureData>| t.as_ref().map_or("-".to_string(), |t| format!("{}x{} f{} {}", t.width, t.height, t.format, t.encoding));
        println!(
            "chunk at {:.0},{:.0},{:.0} size {:.0}x{:.0}x{:.0} res {res} ({:.3} m/sample) mask {} 4ch {} mask2 {} objects {} custom {} trees {}",
            c.position.x, c.position.y, c.position.z, c.size.x, c.size.y, c.size.z, c.size.x / (res - 1) as f32, mask(&c.snow_mask), c.snow_mask_4channel, mask(&c.snow_mask_2),
            c.objects.len(), c.custom_objects.len(), c.tree_prototypes.len()
        );
    }
    let mut ids: BTreeMap<&str, usize> = BTreeMap::new();
    for c in &m.chunks {
        for o in &c.objects {
            *ids.entry(&o.id).or_default() += 1;
        }
    }
    println!("official objects: {ids:?}");
    let mut mats: BTreeMap<String, usize> = BTreeMap::new();
    let mut shapes: BTreeMap<String, usize> = BTreeMap::new();
    for c in &m.chunks {
        for o in &c.custom_objects {
            for p in &o.parts {
                *shapes.entry(p.mesh.clone()).or_default() += 1;
                for mt in &p.materials {
                    let k = format!(
                        "base[{}] metal[{}] rough[{}] normal[{}] emis[{}] mode {} tiling {:.2},{:.2} colour {:.2},{:.2},{:.2} metallic {:.2} smooth {:.2} lit {} extra {:?} kw {:?}",
                        mt.base_tex, mt.metallic_tex, mt.roughness_tex, mt.normal_tex, mt.emission_tex, mt.render_mode, mt.tiling.x, mt.tiling.y,
                        mt.base_color.r, mt.base_color.g, mt.base_color.b, mt.metallic, mt.smoothness, mt.lit, mt.extra_props.keys().collect::<Vec<_>>(), mt.keywords
                    );
                    *mats.entry(k).or_default() += 1;
                }
            }
        }
    }
    println!("custom piece parts by mesh ({}):", shapes.len());
    for (k, n) in shapes.iter().take(40) {
        println!("  {n:4} {k}");
    }
    println!("materials ({}):", mats.len());
    for (k, n) in &mats {
        println!("  {n:4} {k}");
    }
    println!("textures ({}):", m.texture_library.len());
    for (k, t) in &m.texture_library {
        println!("  {k}: {}x{} f{} {} linear {} mips {} comp {} {} KB", t.width, t.height, t.format, t.encoding, t.linear, t.mipmaps, t.compression, t.data.as_ref().map_or(0, |d| d.len() / 1024));
    }
    for c in &m.chunks {
        for t in &c.tree_prototypes {
            println!("tree '{}' parts {} lods {} colliders {} instances {}", t.object_id, t.parts.len(), t.lod_groups.len(), t.colliders.len(), t.instance_count());
            for p in &t.parts {
                for mt in &p.materials {
                    println!("    part {} mat base[{}] normal[{}] mode {} cutoff {} colour {:.2},{:.2},{:.2} extra {:?} kw {:?}", p.mesh, mt.base_tex, mt.normal_tex, mt.render_mode, mt.alpha_cutoff, mt.base_color.r, mt.base_color.g, mt.base_color.b, mt.extra_props.keys().collect::<Vec<_>>(), mt.keywords);
                }
            }
        }
    }
}
