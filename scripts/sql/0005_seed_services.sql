-- =====================================================
-- Fresh Up - Seed Data for Modes, Targets, Categories, Services
-- =====================================================

-- =====================================================
-- MODES (5 total)
-- =====================================================

INSERT INTO modes (id, label, icon, sort_order) VALUES
  ('beauty', 'Beauty', 'sparkles', 1),
  ('vehicle', 'Vehicle', 'car', 2),
  ('pet', 'Pet', 'paw', 3),
  ('home_service', 'Home', 'home', 4),
  ('health', 'Health', 'heart', 5)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order;

-- =====================================================
-- TARGETS (2 per mode = 10 total)
-- =====================================================

INSERT INTO targets (id, mode_id, label, icon, sort_order) VALUES
  -- Beauty
  ('beauty_male', 'beauty', 'Male', '👨', 1),
  ('beauty_female', 'beauty', 'Female', '👩', 2),
  -- Vehicle
  ('vehicle_car', 'vehicle', 'Car', '🚗', 1),
  ('vehicle_motorcycle', 'vehicle', 'Motorcycle', '🏍️', 2),
  -- Pet
  ('pet_dog', 'pet', 'Dog', '🐕', 1),
  ('pet_cat', 'pet', 'Cat', '🐱', 2),
  -- Home
  ('home_apartment', 'home_service', 'Apartment', '🏠', 1),
  ('home_house', 'home_service', 'House', '🏡', 2),
  -- Health
  ('health_individual', 'health', 'Individual', '👤', 1),
  ('health_group', 'health', 'Group', '👥', 2)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon;

-- =====================================================
-- CATEGORIES
-- =====================================================

INSERT INTO categories (id, mode_id, target_id, label, icon, sort_order) VALUES
  -- Beauty > Male
  ('beauty_male_haircut', 'beauty', 'beauty_male', 'Haircut', 'scissors', 1),
  ('beauty_male_braids', 'beauty', 'beauty_male', 'Braids', 'braids', 2),
  ('beauty_male_beard', 'beauty', 'beauty_male', 'Beard', 'beard', 3),
  ('beauty_male_brows', 'beauty', 'beauty_male', 'Brows', 'brows', 4),
  ('beauty_male_body', 'beauty', 'beauty_male', 'Body', 'body', 5),
  
  -- Beauty > Female
  ('beauty_female_haircut', 'beauty', 'beauty_female', 'Haircut', 'scissors', 1),
  ('beauty_female_braids', 'beauty', 'beauty_female', 'Braids', 'braids', 2),
  ('beauty_female_nails', 'beauty', 'beauty_female', 'Nails', 'nails', 3),
  ('beauty_female_lashes', 'beauty', 'beauty_female', 'Lashes', 'lashes', 4),
  ('beauty_female_brows', 'beauty', 'beauty_female', 'Brows', 'brows', 5),
  ('beauty_female_body', 'beauty', 'beauty_female', 'Body', 'body', 6),
  
  -- Vehicle > Car
  ('vehicle_car_wash', 'vehicle', 'vehicle_car', 'Wash', 'wash', 1),
  ('vehicle_car_service', 'vehicle', 'vehicle_car', 'Service', 'service', 2),
  ('vehicle_car_tires', 'vehicle', 'vehicle_car', 'Tires', 'tires', 3),
  ('vehicle_car_interior', 'vehicle', 'vehicle_car', 'Interior', 'interior', 4),
  
  -- Vehicle > Motorcycle
  ('vehicle_mc_wash', 'vehicle', 'vehicle_motorcycle', 'Wash', 'wash', 1),
  ('vehicle_mc_service', 'vehicle', 'vehicle_motorcycle', 'Service', 'service', 2),
  ('vehicle_mc_tires', 'vehicle', 'vehicle_motorcycle', 'Tires', 'tires', 3),
  
  -- Pet > Dog
  ('pet_dog_grooming', 'pet', 'pet_dog', 'Grooming', 'scissors', 1),
  ('pet_dog_vet', 'pet', 'pet_dog', 'Vet', 'vet', 2),
  ('pet_dog_training', 'pet', 'pet_dog', 'Training', 'training', 3),
  ('pet_dog_other', 'pet', 'pet_dog', 'Other', 'paw', 4),
  
  -- Pet > Cat
  ('pet_cat_grooming', 'pet', 'pet_cat', 'Grooming', 'scissors', 1),
  ('pet_cat_vet', 'pet', 'pet_cat', 'Vet', 'vet', 2),
  ('pet_cat_other', 'pet', 'pet_cat', 'Other', 'paw', 3),
  
  -- Home > Apartment
  ('home_apt_cleaning', 'home_service', 'home_apartment', 'Cleaning', 'cleaning', 1),
  ('home_apt_plumber', 'home_service', 'home_apartment', 'Plumber', 'plumber', 2),
  ('home_apt_electrician', 'home_service', 'home_apartment', 'Electrician', 'electrician', 3),
  
  -- Home > House
  ('home_house_cleaning', 'home_service', 'home_house', 'Cleaning', 'cleaning', 1),
  ('home_house_plumber', 'home_service', 'home_house', 'Plumber', 'plumber', 2),
  ('home_house_electrician', 'home_service', 'home_house', 'Electrician', 'electrician', 3),
  ('home_house_garden', 'home_service', 'home_house', 'Garden', 'garden', 4),
  
  -- Health > Individual
  ('health_ind_massage', 'health', 'health_individual', 'Massage', 'massage', 1),
  ('health_ind_physio', 'health', 'health_individual', 'Physio', 'physio', 2),
  ('health_ind_mental', 'health', 'health_individual', 'Mental', 'mental', 3),
  
  -- Health > Group
  ('health_grp_training', 'health', 'health_group', 'Training', 'training', 1),
  ('health_grp_wellness', 'health', 'health_group', 'Wellness', 'wellness', 2)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon;

-- =====================================================
-- SERVICES
-- =====================================================

INSERT INTO services (id, category_id, name, description, duration_minutes, base_price_min, base_price_max, sort_order) VALUES

  -- ─── BEAUTY > MALE > HAIRCUT ─────────────────────────
  ('skin_fade', 'beauty_male_haircut', 'Skin Fade', 'Clean fade down to skin', 30, 350, 450, 1),
  ('low_fade', 'beauty_male_haircut', 'Low Fade', 'Gradual fade low on the sides', 25, 320, 400, 2),
  ('mid_fade', 'beauty_male_haircut', 'Mid Fade', 'Balanced fade at mid-height', 25, 320, 400, 3),
  ('high_fade', 'beauty_male_haircut', 'High Fade', 'Sharp fade high on the sides', 25, 340, 420, 4),
  ('buzz_cut', 'beauty_male_haircut', 'Buzz Cut', 'Quick all-over clipper cut', 15, 200, 280, 5),
  ('classic_cut_m', 'beauty_male_haircut', 'Classic Cut', 'Traditional scissors cut', 30, 350, 450, 6),
  ('scissors_cut', 'beauty_male_haircut', 'Scissors Cut', 'Full scissors, no clippers', 35, 380, 480, 7),
  ('kids_cut_m', 'beauty_male_haircut', 'Kids Cut', 'Haircut for children under 12', 20, 250, 320, 8),

  -- ─── BEAUTY > MALE > BRAIDS ──────────────────────────
  ('box_braids_m', 'beauty_male_braids', 'Box Braids', 'Individual box braids', 120, 800, 1200, 1),
  ('cornrows_m', 'beauty_male_braids', 'Cornrows', 'Straight-back cornrows', 90, 600, 900, 2),
  ('twist_m', 'beauty_male_braids', 'Twists', 'Two-strand twists', 75, 500, 750, 3),

  -- ─── BEAUTY > MALE > BEARD ───────────────────────────
  ('beard_trim', 'beauty_male_beard', 'Beard Trim', 'Shape and trim beard', 15, 150, 220, 1),
  ('beard_shape', 'beauty_male_beard', 'Beard Shape', 'Detailed beard shaping', 20, 180, 280, 2),
  ('beard_fade', 'beauty_male_beard', 'Beard Fade', 'Fade beard into haircut', 25, 220, 320, 3),
  ('beard_dye', 'beauty_male_beard', 'Beard Dye', 'Color beard', 30, 280, 400, 4),

  -- ─── BEAUTY > MALE > BROWS ───────────────────────────
  ('brow_shape_m', 'beauty_male_brows', 'Brow Shape', 'Clean up and shape brows', 15, 120, 180, 1),
  ('brow_tint_m', 'beauty_male_brows', 'Brow Tint', 'Color brows', 20, 180, 250, 2),

  -- ─── BEAUTY > MALE > BODY ────────────────────────────
  ('massage_m', 'beauty_male_body', 'Massage', 'Relaxation massage', 60, 600, 900, 1),
  ('waxing_m', 'beauty_male_body', 'Waxing', 'Body waxing', 30, 300, 500, 2),
  ('facial_m', 'beauty_male_body', 'Facial', 'Deep cleansing facial', 45, 450, 650, 3),

  -- ─── BEAUTY > FEMALE > HAIRCUT ───────────────────────
  ('classic_cut_f', 'beauty_female_haircut', 'Classic Cut', 'Classic women''s haircut with styling', 45, 450, 550, 0),
  ('trim_f', 'beauty_female_haircut', 'Trim', 'Split end trim', 30, 300, 400, 1),
  ('layers_f', 'beauty_female_haircut', 'Layers', 'Layered cut for volume', 45, 450, 600, 2),
  ('bob_f', 'beauty_female_haircut', 'Bob', 'Classic bob cut', 40, 400, 550, 3),
  ('pixie_f', 'beauty_female_haircut', 'Pixie Cut', 'Short pixie style', 35, 380, 500, 4),
  ('bangs_f', 'beauty_female_haircut', 'Bangs', 'Cut or refresh bangs', 20, 150, 250, 5),
  ('kids_cut_f', 'beauty_female_haircut', 'Kids Cut', 'Haircut for children under 12', 25, 280, 380, 6),

  -- ─── BEAUTY > FEMALE > BRAIDS ────────────────────────
  ('box_braids_f', 'beauty_female_braids', 'Box Braids', 'Individual box braids', 180, 1200, 2000, 1),
  ('cornrows_f', 'beauty_female_braids', 'Cornrows', 'Cornrow styles', 120, 800, 1400, 2),
  ('french_braids', 'beauty_female_braids', 'French Braids', 'Classic French braid', 45, 350, 500, 3),
  ('dutch_braids', 'beauty_female_braids', 'Dutch Braids', 'Inverted French braid', 45, 350, 500, 4),
  ('knotless_braids', 'beauty_female_braids', 'Knotless Braids', 'Pain-free knotless technique', 240, 1500, 2500, 5),

  -- ─── BEAUTY > FEMALE > NAILS ─────────────────────────
  ('manicure', 'beauty_female_nails', 'Manicure', 'Classic manicure', 45, 350, 500, 1),
  ('pedicure', 'beauty_female_nails', 'Pedicure', 'Classic pedicure', 50, 400, 550, 2),
  ('gel_nails', 'beauty_female_nails', 'Gel Nails', 'Long-lasting gel polish', 75, 550, 750, 3),
  ('acrylic_nails', 'beauty_female_nails', 'Acrylic Nails', 'Acrylic nail extensions', 90, 700, 1000, 4),
  ('nail_art', 'beauty_female_nails', 'Nail Art', 'Custom nail designs', 60, 450, 700, 5),
  ('nail_repair', 'beauty_female_nails', 'Nail Repair', 'Fix broken nails', 20, 150, 250, 6),

  -- ─── BEAUTY > FEMALE > LASHES ────────────────────────
  ('classic_lashes', 'beauty_female_lashes', 'Classic Lashes', 'Natural look extensions', 90, 700, 1000, 1),
  ('volume_lashes', 'beauty_female_lashes', 'Volume Lashes', 'Full volume look', 120, 900, 1300, 2),
  ('hybrid_lashes', 'beauty_female_lashes', 'Hybrid Lashes', 'Mix of classic and volume', 105, 800, 1150, 3),
  ('lash_lift', 'beauty_female_lashes', 'Lash Lift', 'Natural lash perm', 60, 500, 700, 4),
  ('lash_tint', 'beauty_female_lashes', 'Lash Tint', 'Darken natural lashes', 30, 250, 350, 5),

  -- ─── BEAUTY > FEMALE > BROWS ─────────────────────────
  ('brow_shape_f', 'beauty_female_brows', 'Brow Shape', 'Wax/thread and shape', 20, 180, 280, 1),
  ('brow_tint_f', 'beauty_female_brows', 'Brow Tint', 'Color brows', 25, 220, 320, 2),
  ('brow_lamination', 'beauty_female_brows', 'Brow Lamination', 'Fluffy brow treatment', 45, 450, 600, 3),
  ('microblading', 'beauty_female_brows', 'Microblading', 'Semi-permanent brows', 120, 2500, 4000, 4),

  -- ─── BEAUTY > FEMALE > BODY ──────────────────────────
  ('massage_f', 'beauty_female_body', 'Massage', 'Relaxation massage', 60, 600, 900, 1),
  ('waxing_f', 'beauty_female_body', 'Waxing', 'Body waxing', 30, 300, 500, 2),
  ('facial_f', 'beauty_female_body', 'Facial', 'Deep cleansing facial', 45, 450, 650, 3),
  ('body_scrub', 'beauty_female_body', 'Body Scrub', 'Exfoliating body treatment', 45, 400, 600, 4),

  -- ─── VEHICLE > CAR > WASH ────────────────────────────
  ('car_exterior_wash', 'vehicle_car_wash', 'Exterior Wash', 'Hand wash exterior', 30, 250, 400, 1),
  ('car_interior_clean', 'vehicle_car_wash', 'Interior Clean', 'Vacuum and wipe interior', 45, 350, 500, 2),
  ('car_full_detail', 'vehicle_car_wash', 'Full Detailing', 'Complete inside and out', 180, 1200, 2000, 3),
  ('car_wax_polish', 'vehicle_car_wash', 'Wax & Polish', 'Paint protection', 90, 600, 1000, 4),

  -- ─── VEHICLE > CAR > SERVICE ─────────────────────────
  ('car_oil_change', 'vehicle_car_service', 'Oil Change', 'Engine oil replacement', 45, 500, 800, 1),
  ('car_brake_check', 'vehicle_car_service', 'Brake Check', 'Inspect brake system', 30, 300, 500, 2),
  ('car_battery', 'vehicle_car_service', 'Battery Service', 'Check/replace battery', 20, 200, 400, 3),
  ('car_ac_service', 'vehicle_car_service', 'AC Service', 'Air conditioning check', 60, 600, 1000, 4),
  ('car_air_filter', 'vehicle_car_service', 'Air filter', 'Engine intake air filter replacement', 20, 200, 400, 5),

  -- ─── VEHICLE > CAR > TIRES ───────────────────────────
  ('car_tire_change', 'vehicle_car_tires', 'Tire Change', 'Swap tires', 45, 400, 600, 1),
  ('car_tire_rotation', 'vehicle_car_tires', 'Tire Rotation', 'Rotate tire positions', 30, 250, 400, 2),
  ('car_wheel_alignment', 'vehicle_car_tires', 'Wheel Alignment', 'Align wheels', 45, 500, 800, 3),
  ('car_tire_repair', 'vehicle_car_tires', 'Puncture Repair', 'Fix flat tire', 20, 200, 350, 4),

  -- ─── VEHICLE > CAR > INTERIOR ────────────────────────
  ('car_deep_interior', 'vehicle_car_interior', 'Deep Clean', 'Thorough interior cleaning', 60, 500, 800, 1),
  ('car_leather_care', 'vehicle_car_interior', 'Leather Care', 'Condition leather seats', 45, 400, 650, 2),
  ('car_odor_removal', 'vehicle_car_interior', 'Odor Removal', 'Eliminate bad smells', 90, 600, 1000, 3),

  -- ─── VEHICLE > MOTORCYCLE > WASH ─────────────────────
  ('mc_quick_wash', 'vehicle_mc_wash', 'Quick Wash', 'Fast exterior clean', 20, 150, 250, 1),
  ('mc_full_wash', 'vehicle_mc_wash', 'Full Wash', 'Complete wash', 40, 300, 450, 2),
  ('mc_detail', 'vehicle_mc_wash', 'Premium Detail', 'Detailed cleaning', 90, 600, 900, 3),

  -- ─── VEHICLE > MOTORCYCLE > SERVICE ──────────────────
  ('mc_oil_change', 'vehicle_mc_service', 'Oil Change', 'Engine oil replacement', 30, 350, 550, 1),
  ('mc_brake_service', 'vehicle_mc_service', 'Brake Service', 'Check/replace brakes', 60, 500, 800, 2),
  ('mc_chain_maint', 'vehicle_mc_service', 'Chain Maintenance', 'Clean and lube chain', 30, 250, 400, 3),

  -- ─── VEHICLE > MOTORCYCLE > TIRES ────────────────────
  ('mc_tire_change', 'vehicle_mc_tires', 'Tire Change', 'Replace tires', 30, 300, 500, 1),
  ('mc_puncture_fix', 'vehicle_mc_tires', 'Puncture Repair', 'Fix flat', 20, 150, 300, 2),

  -- ─── PET > DOG > GROOMING ────────────────────────────
  ('dog_full_groom', 'pet_dog_grooming', 'Full Groom', 'Bath, cut, nails, ears', 90, 600, 1000, 1),
  ('dog_bath', 'pet_dog_grooming', 'Bath', 'Wash and dry', 45, 350, 550, 2),
  ('dog_haircut', 'pet_dog_grooming', 'Haircut', 'Fur trimming', 60, 450, 700, 3),
  ('dog_nails', 'pet_dog_grooming', 'Nail Trim', 'Clip nails', 15, 150, 250, 4),
  ('dog_brush', 'pet_dog_grooming', 'Brushing', 'Deshedding brush out', 30, 250, 400, 5),

  -- ─── PET > DOG > VET ─────────────────────────────────
  ('dog_vaccine', 'pet_dog_vet', 'Vaccination', 'Standard vaccines', 30, 500, 800, 1),
  ('dog_health_check', 'pet_dog_vet', 'Health Check', 'General examination', 30, 400, 600, 2),
  ('dog_dental', 'pet_dog_vet', 'Dental Check', 'Teeth examination', 25, 350, 550, 3),
  ('dog_microchip', 'pet_dog_vet', 'Microchip', 'ID chip implant', 20, 400, 600, 4),

  -- ─── PET > DOG > TRAINING ────────────────────────────
  ('dog_obedience', 'pet_dog_training', 'Obedience', 'Basic commands', 60, 500, 800, 1),
  ('dog_tricks', 'pet_dog_training', 'Tricks', 'Fun tricks training', 45, 400, 650, 2),
  ('dog_puppy', 'pet_dog_training', 'Puppy Training', 'Young dog basics', 45, 450, 700, 3),
  ('dog_behavioral', 'pet_dog_training', 'Behavioral', 'Problem behavior help', 60, 600, 900, 4),

  -- ─── PET > DOG > OTHER ───────────────────────────────
  ('dog_sitting', 'pet_dog_other', 'Dog Sitting', 'Pet sitting service', 60, 250, 400, 1),
  ('dog_walking', 'pet_dog_other', 'Dog Walking', 'Walk your dog', 30, 150, 250, 2),
  ('dog_transport', 'pet_dog_other', 'Transport', 'Pet taxi service', 30, 200, 400, 3),

  -- ─── PET > CAT > GROOMING ────────────────────────────
  ('cat_full_groom', 'pet_cat_grooming', 'Full Groom', 'Complete cat grooming', 60, 500, 800, 1),
  ('cat_bath', 'pet_cat_grooming', 'Bath', 'Wash and dry', 45, 400, 600, 2),
  ('cat_brush', 'pet_cat_grooming', 'Brushing', 'Fur brushing', 30, 250, 400, 3),
  ('cat_nails', 'pet_cat_grooming', 'Nail Trim', 'Clip nails', 15, 150, 250, 4),

  -- ─── PET > CAT > VET ─────────────────────────────────
  ('cat_vaccine', 'pet_cat_vet', 'Vaccination', 'Standard vaccines', 30, 500, 800, 1),
  ('cat_health_check', 'pet_cat_vet', 'Health Check', 'General examination', 30, 400, 600, 2),
  ('cat_dental', 'pet_cat_vet', 'Dental Check', 'Teeth examination', 20, 300, 500, 3),

  -- ─── PET > CAT > OTHER ───────────────────────────────
  ('cat_sitting', 'pet_cat_other', 'Cat Sitting', 'Pet sitting service', 60, 250, 400, 1),
  ('cat_transport', 'pet_cat_other', 'Transport', 'Pet taxi service', 30, 200, 400, 2),

  -- ─── HOME > APARTMENT > CLEANING ─────────────────────
  ('apt_regular_clean', 'home_apt_cleaning', 'Regular Clean', 'Standard cleaning', 120, 800, 1200, 1),
  ('apt_deep_clean', 'home_apt_cleaning', 'Deep Clean', 'Thorough deep cleaning', 240, 1500, 2500, 2),
  ('apt_window_clean', 'home_apt_cleaning', 'Window Clean', 'All windows inside', 60, 400, 700, 3),
  ('apt_move_clean', 'home_apt_cleaning', 'Move-out Clean', 'Cleaning for moving', 180, 1200, 2000, 4),

  -- ─── HOME > APARTMENT > PLUMBER ──────────────────────
  ('apt_drain_clog', 'home_apt_plumber', 'Clogged Drain', 'Clear blockage', 60, 600, 1000, 1),
  ('apt_faucet_leak', 'home_apt_plumber', 'Faucet Leak', 'Fix dripping', 45, 450, 750, 2),
  ('apt_toilet_issue', 'home_apt_plumber', 'Toilet Issue', 'Toilet repair', 45, 500, 850, 3),

  -- ─── HOME > APARTMENT > ELECTRICIAN ──────────────────
  ('apt_light_fixture', 'home_apt_electrician', 'Light Fixture', 'Install/replace light', 30, 350, 600, 1),
  ('apt_outlet_repair', 'home_apt_electrician', 'Outlet Repair', 'Fix power outlet', 45, 450, 750, 2),
  ('apt_switch_replace', 'home_apt_electrician', 'Switch Replace', 'Replace light switch', 30, 300, 500, 3),

  -- ─── HOME > HOUSE > CLEANING ─────────────────────────
  ('house_regular_clean', 'home_house_cleaning', 'Regular Clean', 'Standard cleaning', 180, 1200, 1800, 1),
  ('house_deep_clean', 'home_house_cleaning', 'Deep Clean', 'Thorough deep cleaning', 360, 2500, 4000, 2),
  ('house_window_clean', 'home_house_cleaning', 'Window Clean', 'All windows', 90, 600, 1000, 3),
  ('house_move_clean', 'home_house_cleaning', 'Move-out Clean', 'Cleaning for moving', 300, 2000, 3500, 4),

  -- ─── HOME > HOUSE > PLUMBER ──────────────────────────
  ('house_drain_clog', 'home_house_plumber', 'Clogged Drain', 'Clear blockage', 60, 600, 1000, 1),
  ('house_faucet_leak', 'home_house_plumber', 'Faucet Leak', 'Fix dripping', 45, 450, 750, 2),
  ('house_water_heater', 'home_house_plumber', 'Water Heater', 'Heater service', 120, 1000, 2000, 3),
  ('house_pipe_repair', 'home_house_plumber', 'Pipe Repair', 'Fix broken pipe', 90, 800, 1500, 4),

  -- ─── HOME > HOUSE > ELECTRICIAN ──────────────────────
  ('house_light_fixture', 'home_house_electrician', 'Light Fixture', 'Install/replace light', 30, 350, 600, 1),
  ('house_ev_charger', 'home_house_electrician', 'EV Charger', 'Install car charger', 240, 3000, 6000, 2),
  ('house_fuse_box', 'home_house_electrician', 'Fuse Box', 'Electrical panel work', 90, 1000, 2000, 3),
  ('house_outdoor_lights', 'home_house_electrician', 'Outdoor Lights', 'Garden/security lights', 60, 600, 1200, 4),

  -- ─── HOME > HOUSE > GARDEN ───────────────────────────
  ('house_lawn_mow', 'home_house_garden', 'Lawn Mowing', 'Cut grass', 60, 400, 700, 1),
  ('house_hedge_trim', 'home_house_garden', 'Hedge Trim', 'Shape hedges', 90, 600, 1000, 2),
  ('house_leaf_cleanup', 'home_house_garden', 'Leaf Cleanup', 'Remove fallen leaves', 60, 400, 700, 3),
  ('house_snow_removal', 'home_house_garden', 'Snow Removal', 'Clear snow', 45, 350, 600, 4),
  ('house_planting', 'home_house_garden', 'Planting', 'Plant flowers/trees', 90, 500, 900, 5),

  -- ─── HEALTH > INDIVIDUAL > MASSAGE ───────────────────
  ('massage_relaxation', 'health_ind_massage', 'Relaxation', 'Swedish massage', 60, 700, 1000, 1),
  ('massage_deep_tissue', 'health_ind_massage', 'Deep Tissue', 'Muscle relief', 75, 850, 1200, 2),
  ('massage_sports', 'health_ind_massage', 'Sports', 'Athletic recovery', 60, 800, 1100, 3),
  ('massage_hot_stone', 'health_ind_massage', 'Hot Stone', 'Heated stone therapy', 75, 900, 1300, 4),

  -- ─── HEALTH > INDIVIDUAL > PHYSIO ────────────────────
  ('physio_assessment', 'health_ind_physio', 'Assessment', 'Initial evaluation', 45, 600, 900, 1),
  ('physio_treatment', 'health_ind_physio', 'Treatment', 'Therapy session', 45, 550, 850, 2),
  ('physio_rehab', 'health_ind_physio', 'Rehabilitation', 'Post-injury rehab', 60, 700, 1000, 3),
  ('physio_posture', 'health_ind_physio', 'Posture Correction', 'Alignment work', 45, 600, 900, 4),

  -- ─── HEALTH > INDIVIDUAL > MENTAL ────────────────────
  ('mental_therapy', 'health_ind_mental', 'Therapy', 'Talk therapy session', 60, 800, 1200, 1),
  ('mental_stress', 'health_ind_mental', 'Stress Management', 'Coping techniques', 45, 650, 950, 2),
  ('mental_coaching', 'health_ind_mental', 'Life Coaching', 'Personal development', 60, 750, 1100, 3),

  -- ─── HEALTH > GROUP > TRAINING ───────────────────────
  ('group_yoga', 'health_grp_training', 'Yoga', 'Group yoga session', 60, 200, 350, 1),
  ('group_pilates', 'health_grp_training', 'Pilates', 'Core strength workout', 60, 200, 350, 2),
  ('group_hiit', 'health_grp_training', 'HIIT', 'High intensity training', 45, 180, 300, 3),
  ('group_spinning', 'health_grp_training', 'Spinning', 'Indoor cycling', 45, 180, 300, 4),

  -- ─── HEALTH > GROUP > WELLNESS ───────────────────────
  ('group_meditation', 'health_grp_wellness', 'Meditation', 'Guided meditation', 45, 150, 250, 1),
  ('group_breathing', 'health_grp_wellness', 'Breathing', 'Breathwork session', 30, 120, 200, 2),
  ('group_sound_bath', 'health_grp_wellness', 'Sound Bath', 'Sound healing', 60, 200, 350, 3)

ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  duration_minutes = EXCLUDED.duration_minutes,
  base_price_min = EXCLUDED.base_price_min,
  base_price_max = EXCLUDED.base_price_max;
