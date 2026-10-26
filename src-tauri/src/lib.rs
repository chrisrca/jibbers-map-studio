mod bootlog;
mod commands;
mod discord;
mod game;
mod gamelook;
pub mod jbrmap;
mod library;
mod project;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    bootlog::start();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            discord::discord_presence,
            commands::game::game_object_look,
            commands::game::game_lights,
            commands::game::game_spins,
            commands::game::game_mark,
            commands::game::game_sky,
            commands::game::game_terrain,
            commands::files::copy_dir,
            commands::app::boot_mark,
            commands::projects::remove_empty_session,
            commands::projects::set_scenery_inner,
            commands::projects::repaint_scenery,
            commands::projects::set_model_meshes,
            commands::net::http_fetch,
            commands::game::link_health,
            commands::net::overpass_query,
            commands::projects::add_scenery,
            commands::app::save_lag_report,
            commands::projects::copy_piece_assets,
            commands::files::read_image_rgba,
            commands::game::game_close,
            commands::game::save_game_diagnostics,
            commands::library::list_library_maps,
            commands::library::set_library_map,
            commands::app::app_info,
            commands::files::read_text,
            commands::files::write_text,
            commands::files::read_binary,
            commands::files::write_binary,
            commands::files::path_exists,
            commands::files::file_stamp,
            commands::projects::find_projects,
            commands::projects::load_project,
            commands::projects::save_project,
            commands::projects::import_jbrmap,
            commands::projects::export_project,
            commands::game::play_in_game,
            commands::game::game_status,
            commands::assets::prepare_assets,
            commands::assets::list_user_assets,
            commands::assets::import_user_asset,
            commands::assets::add_asset_to_project,
            commands::assets::save_custom_as_asset,
            commands::assets::delete_user_asset,
            commands::library::library_entry_preview,
            commands::library::list_library,
            commands::app::recycle,
            commands::library::show_library_folder,
            commands::projects::add_texture_to_project,
            commands::library::place_library_mesh,
            commands::library::refresh_library_mesh,
            commands::library::place_library_meshes,
            commands::library::stale_game_look,
            commands::library::place_library_material,
            commands::assets::list_user_materials,
            commands::assets::import_material_image,
            commands::assets::save_material_from_project,
            commands::assets::add_material_to_project,
            commands::game::game_attach,
            commands::game::game_set_visible,
            commands::game::game_focus,
            commands::game::game_release,
            commands::game::game_pop_out,
            commands::game::list_game_maps,
            commands::app::frontend_log,
            commands::app::selftest_dir,
            commands::projects::generate_project,
        ])
        .setup(|app| {
            // the player's own screen mode back, should the studio have stopped before the game it had windowed
            std::thread::spawn(game::restore_screen);
            // the window opens hidden and the page shows it once its first screen is drawn; should the page never get
            // that far, it's shown anyway
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(20));
                    if !w.is_visible().unwrap_or(true) {
                        bootlog::mark("window shown by the fallback (the page didn't)");
                        let _ = w.show();
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|_, event| {
            // The game's window is our child while embedded: closing the studio closes it too (a popped-out game
            // keeps running). Only once it's really closing: a close asked for can be cancelled (unsaved changes).
            if let tauri::WindowEvent::Destroyed = event {
                game::embed::close_embedded_game();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Jibbers Map Studio");
}
