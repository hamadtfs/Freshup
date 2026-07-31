SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict FxHiHsKBusBwCa4O7KnR1SSvShA80jQvNlqK0uhak1q6znDOQEX9liYclVdfweP

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: custom_oauth_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: modes; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."modes" ("id", "label", "icon", "sort_order", "created_at") VALUES
	('beauty', 'Beauty', 'sparkles', 1, '2026-04-06 11:26:36.450787+00'),
	('vehicle', 'Vehicle', 'car', 2, '2026-04-06 11:26:36.450787+00'),
	('pet', 'Pet', 'paw-print', 3, '2026-04-06 11:26:36.450787+00'),
	('home_service', 'Home', 'home', 4, '2026-04-06 11:26:36.450787+00'),
	('health', 'Health', 'heart', 5, '2026-04-06 11:26:36.450787+00');


--
-- Data for Name: targets; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."targets" ("id", "mode_id", "label", "icon", "sort_order", "created_at") VALUES
	('beauty_male', 'beauty', 'Male', '👨', 1, '2026-04-06 11:26:36.450787+00'),
	('beauty_female', 'beauty', 'Female', '👩', 2, '2026-04-06 11:26:36.450787+00'),
	('vehicle_car', 'vehicle', 'Car', '🚗', 1, '2026-04-06 11:26:36.450787+00'),
	('vehicle_motorcycle', 'vehicle', 'Motorcycle', '🏍️', 2, '2026-04-06 11:26:36.450787+00'),
	('pet_dog', 'pet', 'Dog', '🐕', 1, '2026-04-06 11:26:36.450787+00'),
	('pet_cat', 'pet', 'Cat', '🐱', 2, '2026-04-06 11:26:36.450787+00'),
	('home_apartment', 'home_service', 'Apartment', '🏠', 1, '2026-04-06 11:26:36.450787+00'),
	('home_house', 'home_service', 'House', '🏡', 2, '2026-04-06 11:26:36.450787+00'),
	('health_individual', 'health', 'Individual', '👤', 1, '2026-04-06 11:26:36.450787+00'),
	('health_group', 'health', 'Group', '👥', 2, '2026-04-06 11:26:36.450787+00');


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."categories" ("id", "mode_id", "target_id", "label", "icon", "sort_order", "created_at") VALUES
	('beauty_male_haircut', 'beauty', 'beauty_male', 'Haircut', 'scissors', 1, '2026-04-06 11:27:02.478626+00'),
	('beauty_male_braids', 'beauty', 'beauty_male', 'Braids', 'link', 2, '2026-04-06 11:27:02.478626+00'),
	('beauty_male_beard', 'beauty', 'beauty_male', 'Beard', 'user', 3, '2026-04-06 11:27:02.478626+00'),
	('beauty_male_brows', 'beauty', 'beauty_male', 'Brows', 'eye', 4, '2026-04-06 11:27:02.478626+00'),
	('beauty_male_body', 'beauty', 'beauty_male', 'Body', 'user', 5, '2026-04-06 11:27:02.478626+00'),
	('beauty_female_haircut', 'beauty', 'beauty_female', 'Haircut', 'scissors', 1, '2026-04-06 11:27:02.478626+00'),
	('beauty_female_braids', 'beauty', 'beauty_female', 'Braids', 'link', 2, '2026-04-06 11:27:02.478626+00'),
	('beauty_female_nails', 'beauty', 'beauty_female', 'Nails', 'hand', 3, '2026-04-06 11:27:02.478626+00'),
	('beauty_female_lashes', 'beauty', 'beauty_female', 'Lashes', 'eye', 4, '2026-04-06 11:27:02.478626+00'),
	('beauty_female_brows', 'beauty', 'beauty_female', 'Brows', 'eye', 5, '2026-04-06 11:27:02.478626+00'),
	('beauty_female_body', 'beauty', 'beauty_female', 'Body', 'user', 6, '2026-04-06 11:27:02.478626+00'),
	('vehicle_car_wash', 'vehicle', 'vehicle_car', 'Wash', 'droplet', 1, '2026-04-06 11:27:02.478626+00'),
	('vehicle_car_service', 'vehicle', 'vehicle_car', 'Service', 'wrench', 2, '2026-04-06 11:27:02.478626+00'),
	('vehicle_car_tires', 'vehicle', 'vehicle_car', 'Tires', 'circle', 3, '2026-04-06 11:27:02.478626+00'),
	('vehicle_car_interior', 'vehicle', 'vehicle_car', 'Interior', 'sofa', 4, '2026-04-06 11:27:02.478626+00'),
	('vehicle_mc_wash', 'vehicle', 'vehicle_motorcycle', 'Wash', 'droplet', 1, '2026-04-06 11:27:02.478626+00'),
	('vehicle_mc_service', 'vehicle', 'vehicle_motorcycle', 'Service', 'wrench', 2, '2026-04-06 11:27:02.478626+00'),
	('vehicle_mc_tires', 'vehicle', 'vehicle_motorcycle', 'Tires', 'circle', 3, '2026-04-06 11:27:02.478626+00'),
	('pet_dog_grooming', 'pet', 'pet_dog', 'Grooming', 'scissors', 1, '2026-04-06 11:27:02.478626+00'),
	('pet_dog_vet', 'pet', 'pet_dog', 'Vet', 'stethoscope', 2, '2026-04-06 11:27:02.478626+00'),
	('pet_dog_training', 'pet', 'pet_dog', 'Training', 'award', 3, '2026-04-06 11:27:02.478626+00'),
	('pet_dog_other', 'pet', 'pet_dog', 'Other', 'paw-print', 4, '2026-04-06 11:27:02.478626+00'),
	('pet_cat_grooming', 'pet', 'pet_cat', 'Grooming', 'scissors', 1, '2026-04-06 11:27:02.478626+00'),
	('pet_cat_vet', 'pet', 'pet_cat', 'Vet', 'stethoscope', 2, '2026-04-06 11:27:02.478626+00'),
	('pet_cat_other', 'pet', 'pet_cat', 'Other', 'paw-print', 3, '2026-04-06 11:27:02.478626+00'),
	('home_apt_cleaning', 'home_service', 'home_apartment', 'Cleaning', 'sparkles', 1, '2026-04-06 11:27:02.478626+00'),
	('home_apt_plumber', 'home_service', 'home_apartment', 'Plumber', 'droplet', 2, '2026-04-06 11:27:02.478626+00'),
	('home_apt_electrician', 'home_service', 'home_apartment', 'Electrician', 'zap', 3, '2026-04-06 11:27:02.478626+00'),
	('home_house_cleaning', 'home_service', 'home_house', 'Cleaning', 'sparkles', 1, '2026-04-06 11:27:02.478626+00'),
	('home_house_plumber', 'home_service', 'home_house', 'Plumber', 'droplet', 2, '2026-04-06 11:27:02.478626+00'),
	('home_house_electrician', 'home_service', 'home_house', 'Electrician', 'zap', 3, '2026-04-06 11:27:02.478626+00'),
	('home_house_garden', 'home_service', 'home_house', 'Garden', 'tree', 4, '2026-04-06 11:27:02.478626+00'),
	('health_ind_massage', 'health', 'health_individual', 'Massage', 'hand', 1, '2026-04-06 11:27:02.478626+00'),
	('health_ind_physio', 'health', 'health_individual', 'Physio', 'activity', 2, '2026-04-06 11:27:02.478626+00'),
	('health_ind_mental', 'health', 'health_individual', 'Mental', 'brain', 3, '2026-04-06 11:27:02.478626+00'),
	('health_grp_training', 'health', 'health_group', 'Training', 'users', 1, '2026-04-06 11:27:02.478626+00'),
	('health_grp_wellness', 'health', 'health_group', 'Wellness', 'heart', 2, '2026-04-06 11:27:02.478626+00');


--
-- Data for Name: customer_details; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: provider_details; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: services; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."services" ("id", "mode_id", "target_id", "category_id", "name", "description", "duration_minutes", "base_price_min", "base_price_max", "sort_order", "is_active", "created_at") VALUES
	('skin_fade', 'beauty', 'beauty_male', 'beauty_male_haircut', 'Skin Fade', 'Clean fade down to the skin', 30, 350, 450, 1, true, '2026-04-06 11:28:00.872886+00'),
	('low_fade', 'beauty', 'beauty_male', 'beauty_male_haircut', 'Low Fade', 'Subtle fade starting low', 25, 300, 400, 2, true, '2026-04-06 11:28:00.872886+00'),
	('mid_fade', 'beauty', 'beauty_male', 'beauty_male_haircut', 'Mid Fade', 'Fade starting at mid level', 25, 300, 400, 3, true, '2026-04-06 11:28:00.872886+00'),
	('high_fade', 'beauty', 'beauty_male', 'beauty_male_haircut', 'High Fade', 'Fade starting high on head', 25, 300, 400, 4, true, '2026-04-06 11:28:00.872886+00'),
	('buzz_cut', 'beauty', 'beauty_male', 'beauty_male_haircut', 'Buzz Cut', 'Short all over clipper cut', 15, 200, 300, 5, true, '2026-04-06 11:28:00.872886+00'),
	('classic_cut_m', 'beauty', 'beauty_male', 'beauty_male_haircut', 'Classic Cut', 'Traditional mens haircut', 30, 350, 450, 6, true, '2026-04-06 11:28:00.872886+00'),
	('box_braids_m', 'beauty', 'beauty_male', 'beauty_male_braids', 'Box Braids', 'Individual box braids', 120, 800, 1200, 1, true, '2026-04-06 11:28:00.872886+00'),
	('cornrows_m', 'beauty', 'beauty_male', 'beauty_male_braids', 'Cornrows', 'Classic cornrow style', 90, 600, 900, 2, true, '2026-04-06 11:28:00.872886+00'),
	('beard_trim', 'beauty', 'beauty_male', 'beauty_male_beard', 'Beard Trim', 'Shape and trim beard', 15, 150, 250, 1, true, '2026-04-06 11:28:00.872886+00'),
	('beard_shape', 'beauty', 'beauty_male', 'beauty_male_beard', 'Beard Shape', 'Define beard lines', 20, 200, 300, 2, true, '2026-04-06 11:28:00.872886+00'),
	('beard_dye', 'beauty', 'beauty_male', 'beauty_male_beard', 'Beard Dye', 'Color your beard', 30, 300, 450, 3, true, '2026-04-06 11:28:00.872886+00'),
	('brow_shape_m', 'beauty', 'beauty_male', 'beauty_male_brows', 'Brow Shape', 'Clean up eyebrows', 15, 150, 200, 1, true, '2026-04-06 11:28:00.872886+00'),
	('brow_tint_m', 'beauty', 'beauty_male', 'beauty_male_brows', 'Brow Tint', 'Color eyebrows', 20, 200, 300, 2, true, '2026-04-06 11:28:00.872886+00'),
	('massage_m', 'beauty', 'beauty_male', 'beauty_male_body', 'Massage', 'Relaxing body massage', 60, 600, 900, 1, true, '2026-04-06 11:28:00.872886+00'),
	('waxing_m', 'beauty', 'beauty_male', 'beauty_male_body', 'Waxing', 'Body hair removal', 30, 300, 500, 2, true, '2026-04-06 11:28:00.872886+00'),
	('facial_m', 'beauty', 'beauty_male', 'beauty_male_body', 'Facial', 'Deep cleansing facial', 45, 450, 650, 3, true, '2026-04-06 11:28:00.872886+00'),
	('trim_f', 'beauty', 'beauty_female', 'beauty_female_haircut', 'Trim', 'Light trim to refresh ends', 30, 300, 450, 1, true, '2026-04-06 11:28:42.325523+00'),
	('layers_f', 'beauty', 'beauty_female', 'beauty_female_haircut', 'Layers', 'Layered cut for volume', 45, 450, 650, 2, true, '2026-04-06 11:28:42.325523+00'),
	('bob_f', 'beauty', 'beauty_female', 'beauty_female_haircut', 'Bob', 'Classic bob haircut', 40, 400, 600, 3, true, '2026-04-06 11:28:42.325523+00'),
	('pixie_f', 'beauty', 'beauty_female', 'beauty_female_haircut', 'Pixie Cut', 'Short pixie style', 35, 350, 500, 4, true, '2026-04-06 11:28:42.325523+00'),
	('box_braids_f', 'beauty', 'beauty_female', 'beauty_female_braids', 'Box Braids', 'Individual box braids', 180, 1200, 2000, 1, true, '2026-04-06 11:28:42.325523+00'),
	('cornrows_f', 'beauty', 'beauty_female', 'beauty_female_braids', 'Cornrows', 'Classic cornrow style', 120, 800, 1200, 2, true, '2026-04-06 11:28:42.325523+00'),
	('french_braids', 'beauty', 'beauty_female', 'beauty_female_braids', 'French Braids', 'Elegant french braids', 45, 400, 600, 3, true, '2026-04-06 11:28:42.325523+00'),
	('dutch_braids', 'beauty', 'beauty_female', 'beauty_female_braids', 'Dutch Braids', 'Dutch braid style', 45, 400, 600, 4, true, '2026-04-06 11:28:42.325523+00'),
	('manicure', 'beauty', 'beauty_female', 'beauty_female_nails', 'Manicure', 'Classic nail care', 45, 350, 500, 1, true, '2026-04-06 11:28:42.325523+00'),
	('pedicure', 'beauty', 'beauty_female', 'beauty_female_nails', 'Pedicure', 'Foot and nail care', 50, 400, 550, 2, true, '2026-04-06 11:28:42.325523+00'),
	('gel_nails', 'beauty', 'beauty_female', 'beauty_female_nails', 'Gel Nails', 'Long lasting gel polish', 75, 550, 800, 3, true, '2026-04-06 11:28:42.325523+00'),
	('acrylic_nails', 'beauty', 'beauty_female', 'beauty_female_nails', 'Acrylic Nails', 'Acrylic nail extensions', 90, 700, 1000, 4, true, '2026-04-06 11:28:42.325523+00'),
	('classic_lashes', 'beauty', 'beauty_female', 'beauty_female_lashes', 'Classic Lashes', 'Natural lash extensions', 90, 800, 1200, 1, true, '2026-04-06 11:28:42.325523+00'),
	('volume_lashes', 'beauty', 'beauty_female', 'beauty_female_lashes', 'Volume Lashes', 'Full volume extensions', 120, 1000, 1500, 2, true, '2026-04-06 11:28:42.325523+00'),
	('hybrid_lashes', 'beauty', 'beauty_female', 'beauty_female_lashes', 'Hybrid Lashes', 'Mix of classic and volume', 100, 900, 1300, 3, true, '2026-04-06 11:28:42.325523+00'),
	('brow_shape_f', 'beauty', 'beauty_female', 'beauty_female_brows', 'Brow Shape', 'Perfect brow shaping', 20, 200, 300, 1, true, '2026-04-06 11:28:42.325523+00'),
	('brow_tint_f', 'beauty', 'beauty_female', 'beauty_female_brows', 'Brow Tint', 'Brow coloring', 25, 250, 350, 2, true, '2026-04-06 11:28:42.325523+00'),
	('brow_lamination', 'beauty', 'beauty_female', 'beauty_female_brows', 'Brow Lamination', 'Brow lifting treatment', 45, 500, 700, 3, true, '2026-04-06 11:28:42.325523+00'),
	('massage_f', 'beauty', 'beauty_female', 'beauty_female_body', 'Massage', 'Relaxing body massage', 60, 600, 900, 1, true, '2026-04-06 11:28:42.325523+00'),
	('waxing_f', 'beauty', 'beauty_female', 'beauty_female_body', 'Waxing', 'Body hair removal', 30, 300, 500, 2, true, '2026-04-06 11:28:42.325523+00'),
	('facial_f', 'beauty', 'beauty_female', 'beauty_female_body', 'Facial', 'Deep cleansing facial', 45, 450, 650, 3, true, '2026-04-06 11:28:42.325523+00'),
	('car_exterior', 'vehicle', 'vehicle_car', 'vehicle_car_wash', 'Exterior Wash', 'Complete exterior cleaning', 30, 300, 500, 1, true, '2026-04-06 11:29:12.967067+00'),
	('car_interior_wash', 'vehicle', 'vehicle_car', 'vehicle_car_wash', 'Interior Wash', 'Full interior cleaning', 45, 400, 600, 2, true, '2026-04-06 11:29:12.967067+00'),
	('car_full_detail', 'vehicle', 'vehicle_car', 'vehicle_car_wash', 'Full Detailing', 'Complete car detailing', 180, 1500, 2500, 3, true, '2026-04-06 11:29:12.967067+00'),
	('car_oil_change', 'vehicle', 'vehicle_car', 'vehicle_car_service', 'Oil Change', 'Engine oil replacement', 45, 500, 800, 1, true, '2026-04-06 11:29:12.967067+00'),
	('car_brake_check', 'vehicle', 'vehicle_car', 'vehicle_car_service', 'Brake Check', 'Brake inspection', 30, 300, 500, 2, true, '2026-04-06 11:29:12.967067+00'),
	('car_battery', 'vehicle', 'vehicle_car', 'vehicle_car_service', 'Battery Service', 'Battery check and replacement', 20, 200, 400, 3, true, '2026-04-06 11:29:12.967067+00'),
	('car_tire_change', 'vehicle', 'vehicle_car', 'vehicle_car_tires', 'Tire Change', 'Swap tires', 45, 400, 600, 1, true, '2026-04-06 11:29:12.967067+00'),
	('car_tire_hotel', 'vehicle', 'vehicle_car', 'vehicle_car_tires', 'Tire Hotel', 'Seasonal tire storage', 20, 200, 400, 2, true, '2026-04-06 11:29:12.967067+00'),
	('car_wheel_align', 'vehicle', 'vehicle_car', 'vehicle_car_tires', 'Wheel Alignment', 'Align all wheels', 45, 500, 800, 3, true, '2026-04-06 11:29:12.967067+00'),
	('car_vacuum', 'vehicle', 'vehicle_car', 'vehicle_car_interior', 'Vacuuming', 'Deep vacuum cleaning', 30, 250, 400, 1, true, '2026-04-06 11:29:12.967067+00'),
	('car_deep_clean', 'vehicle', 'vehicle_car', 'vehicle_car_interior', 'Deep Clean', 'Complete interior deep clean', 60, 600, 900, 2, true, '2026-04-06 11:29:12.967067+00'),
	('car_odor', 'vehicle', 'vehicle_car', 'vehicle_car_interior', 'Odor Removal', 'Eliminate odors', 90, 800, 1200, 3, true, '2026-04-06 11:29:12.967067+00'),
	('mc_quick_wash', 'vehicle', 'vehicle_motorcycle', 'vehicle_mc_wash', 'Quick Wash', 'Fast exterior wash', 20, 200, 300, 1, true, '2026-04-06 11:29:12.967067+00'),
	('mc_full_wash', 'vehicle', 'vehicle_motorcycle', 'vehicle_mc_wash', 'Full Wash', 'Complete wash', 40, 350, 500, 2, true, '2026-04-06 11:29:12.967067+00'),
	('mc_premium', 'vehicle', 'vehicle_motorcycle', 'vehicle_mc_wash', 'Premium Detail', 'Premium detailing', 90, 700, 1000, 3, true, '2026-04-06 11:29:12.967067+00'),
	('mc_oil_change', 'vehicle', 'vehicle_motorcycle', 'vehicle_mc_service', 'Oil Change', 'Engine oil change', 30, 400, 600, 1, true, '2026-04-06 11:29:12.967067+00'),
	('mc_brake', 'vehicle', 'vehicle_motorcycle', 'vehicle_mc_service', 'Brake Service', 'Brake check and change', 60, 600, 900, 2, true, '2026-04-06 11:29:12.967067+00'),
	('mc_chain', 'vehicle', 'vehicle_motorcycle', 'vehicle_mc_service', 'Chain Maintenance', 'Chain cleaning and lube', 30, 300, 450, 3, true, '2026-04-06 11:29:12.967067+00'),
	('mc_tire_change', 'vehicle', 'vehicle_motorcycle', 'vehicle_mc_tires', 'Tire Change', 'Replace tires', 30, 350, 550, 1, true, '2026-04-06 11:29:12.967067+00'),
	('mc_tire_hotel', 'vehicle', 'vehicle_motorcycle', 'vehicle_mc_tires', 'Tire Hotel', 'Tire storage', 15, 150, 250, 2, true, '2026-04-06 11:29:12.967067+00'),
	('mc_puncture', 'vehicle', 'vehicle_motorcycle', 'vehicle_mc_tires', 'Puncture Fix', 'Repair puncture', 20, 200, 350, 3, true, '2026-04-06 11:29:12.967067+00'),
	('dog_grooming_full', 'pet', 'pet_dog', 'pet_dog_grooming', 'Full Grooming', 'Complete dog grooming', 60, 600, 1000, 1, true, '2026-04-06 11:29:28.804079+00'),
	('dog_nail_trim', 'pet', 'pet_dog', 'pet_dog_grooming', 'Nail Trim', 'Trim dog nails', 15, 150, 250, 2, true, '2026-04-06 11:29:28.804079+00'),
	('dog_bath', 'pet', 'pet_dog', 'pet_dog_grooming', 'Bath', 'Dog bathing service', 45, 350, 600, 3, true, '2026-04-06 11:29:28.804079+00'),
	('dog_brushing', 'pet', 'pet_dog', 'pet_dog_grooming', 'Brushing', 'Coat brushing', 30, 250, 400, 4, true, '2026-04-06 11:29:28.804079+00'),
	('dog_vaccination', 'pet', 'pet_dog', 'pet_dog_vet', 'Vaccination', 'Dog vaccination', 30, 400, 700, 1, true, '2026-04-06 11:29:28.804079+00'),
	('dog_health_check', 'pet', 'pet_dog', 'pet_dog_vet', 'Health Check', 'General health checkup', 30, 350, 600, 2, true, '2026-04-06 11:29:28.804079+00'),
	('dog_dental', 'pet', 'pet_dog', 'pet_dog_vet', 'Dental Check', 'Dental examination', 25, 300, 500, 3, true, '2026-04-06 11:29:28.804079+00'),
	('dog_obedience', 'pet', 'pet_dog', 'pet_dog_training', 'Obedience', 'Basic obedience training', 60, 600, 1000, 1, true, '2026-04-06 11:29:28.804079+00'),
	('dog_tricks', 'pet', 'pet_dog', 'pet_dog_training', 'Tricks', 'Teach dog tricks', 45, 400, 700, 2, true, '2026-04-06 11:29:28.804079+00'),
	('dog_puppy', 'pet', 'pet_dog', 'pet_dog_training', 'Puppy Training', 'Puppy training class', 45, 400, 650, 3, true, '2026-04-06 11:29:28.804079+00'),
	('dog_sitting', 'pet', 'pet_dog', 'pet_dog_other', 'Dog Sitting', 'Care for dog while away', 60, 300, 600, 1, true, '2026-04-06 11:29:28.804079+00'),
	('dog_walking', 'pet', 'pet_dog', 'pet_dog_other', 'Dog Walking', 'Walk your dog', 30, 200, 400, 2, true, '2026-04-06 11:29:28.804079+00'),
	('dog_transport', 'pet', 'pet_dog', 'pet_dog_other', 'Transport', 'Transport your dog', 30, 250, 450, 3, true, '2026-04-06 11:29:28.804079+00'),
	('cat_grooming_full', 'pet', 'pet_cat', 'pet_cat_grooming', 'Full Grooming', 'Complete cat grooming', 45, 400, 700, 1, true, '2026-04-06 11:29:28.804079+00'),
	('cat_nail_trim', 'pet', 'pet_cat', 'pet_cat_grooming', 'Nail Trim', 'Trim cat nails', 15, 150, 250, 2, true, '2026-04-06 11:29:28.804079+00'),
	('cat_brushing', 'pet', 'pet_cat', 'pet_cat_grooming', 'Brushing', 'Coat brushing', 30, 250, 400, 3, true, '2026-04-06 11:29:28.804079+00'),
	('cat_vaccination', 'pet', 'pet_cat', 'pet_cat_vet', 'Vaccination', 'Cat vaccination', 30, 400, 700, 1, true, '2026-04-06 11:29:28.804079+00'),
	('cat_health_check', 'pet', 'pet_cat', 'pet_cat_vet', 'Health Check', 'General health checkup', 30, 350, 600, 2, true, '2026-04-06 11:29:28.804079+00'),
	('cat_dental', 'pet', 'pet_cat', 'pet_cat_vet', 'Dental Check', 'Dental examination', 25, 300, 500, 3, true, '2026-04-06 11:29:28.804079+00'),
	('cat_sitting', 'pet', 'pet_cat', 'pet_cat_other', 'Cat Sitting', 'Care for cat while away', 60, 250, 500, 1, true, '2026-04-06 11:29:28.804079+00'),
	('cat_transport', 'pet', 'pet_cat', 'pet_cat_other', 'Transport', 'Transport your cat', 30, 250, 450, 2, true, '2026-04-06 11:29:28.804079+00'),
	('apt_regular_clean', 'home_service', 'home_apartment', 'home_apt_cleaning', 'Regular Clean', 'Standard apartment cleaning', 120, 600, 1000, 1, true, '2026-04-06 11:29:41.364417+00'),
	('apt_deep_clean', 'home_service', 'home_apartment', 'home_apt_cleaning', 'Deep Clean', 'Thorough deep cleaning', 240, 1200, 2000, 2, true, '2026-04-06 11:29:41.364417+00'),
	('apt_window_clean', 'home_service', 'home_apartment', 'home_apt_cleaning', 'Window Clean', 'Window cleaning', 60, 400, 700, 3, true, '2026-04-06 11:29:41.364417+00'),
	('apt_drain_clog', 'home_service', 'home_apartment', 'home_apt_plumber', 'Clogged Drain', 'Unclog drain', 60, 500, 900, 1, true, '2026-04-06 11:29:41.364417+00'),
	('apt_faucet_leak', 'home_service', 'home_apartment', 'home_apt_plumber', 'Faucet Leak', 'Fix leaking faucet', 45, 400, 700, 2, true, '2026-04-06 11:29:41.364417+00'),
	('apt_toilet_issue', 'home_service', 'home_apartment', 'home_apt_plumber', 'Toilet Issue', 'Toilet repair', 45, 400, 700, 3, true, '2026-04-06 11:29:41.364417+00'),
	('apt_light_point', 'home_service', 'home_apartment', 'home_apt_electrician', 'Light Point', 'Install light fixture', 30, 300, 600, 1, true, '2026-04-06 11:29:41.364417+00'),
	('apt_outlets', 'home_service', 'home_apartment', 'home_apt_electrician', 'Outlets', 'Install outlets', 45, 400, 800, 2, true, '2026-04-06 11:29:41.364417+00'),
	('apt_fuse_box', 'home_service', 'home_apartment', 'home_apt_electrician', 'Fuse Box', 'Fuse box work', 60, 600, 1200, 3, true, '2026-04-06 11:29:41.364417+00'),
	('house_regular_clean', 'home_service', 'home_house', 'home_house_cleaning', 'Regular Clean', 'Standard house cleaning', 180, 900, 1500, 1, true, '2026-04-06 11:29:41.364417+00'),
	('house_deep_clean', 'home_service', 'home_house', 'home_house_cleaning', 'Deep Clean', 'Thorough deep cleaning', 360, 1800, 3000, 2, true, '2026-04-06 11:29:41.364417+00'),
	('house_window_clean', 'home_service', 'home_house', 'home_house_cleaning', 'Window Clean', 'Window cleaning', 90, 600, 1000, 3, true, '2026-04-06 11:29:41.364417+00'),
	('house_facade_wash', 'home_service', 'home_house', 'home_house_cleaning', 'Facade Wash', 'Exterior house washing', 180, 1000, 1800, 4, true, '2026-04-06 11:29:41.364417+00'),
	('house_drain_clog', 'home_service', 'home_house', 'home_house_plumber', 'Clogged Drain', 'Unclog drain', 60, 500, 900, 1, true, '2026-04-06 11:29:41.364417+00'),
	('house_faucet_leak', 'home_service', 'home_house', 'home_house_plumber', 'Faucet Leak', 'Fix leaking faucet', 45, 400, 700, 2, true, '2026-04-06 11:29:41.364417+00'),
	('house_water_heater', 'home_service', 'home_house', 'home_house_plumber', 'Water Heater', 'Water heater service', 120, 1000, 1800, 3, true, '2026-04-06 11:29:41.364417+00'),
	('house_light_point', 'home_service', 'home_house', 'home_house_electrician', 'Light Point', 'Install light fixture', 30, 300, 600, 1, true, '2026-04-06 11:29:41.364417+00'),
	('house_ev_charger', 'home_service', 'home_house', 'home_house_electrician', 'EV Charger', 'Install EV charger', 240, 2000, 4000, 2, true, '2026-04-06 11:29:41.364417+00'),
	('house_fuse_box', 'home_service', 'home_house', 'home_house_electrician', 'Fuse Box', 'Fuse box work', 60, 600, 1200, 3, true, '2026-04-06 11:29:41.364417+00'),
	('garden_lawn_mow', 'home_service', 'home_house', 'home_house_garden', 'Lawn Mowing', 'Mow lawn', 60, 400, 800, 1, true, '2026-04-06 11:29:41.364417+00'),
	('garden_hedge_trim', 'home_service', 'home_house', 'home_house_garden', 'Hedge Trim', 'Trim hedges', 90, 600, 1200, 2, true, '2026-04-06 11:29:41.364417+00'),
	('garden_snow', 'home_service', 'home_house', 'home_house_garden', 'Snow Removal', 'Remove snow', 45, 500, 1000, 3, true, '2026-04-06 11:29:41.364417+00'),
	('massage_relaxation', 'health', 'health_individual', 'health_ind_massage', 'Relaxation', 'Relaxing full body massage', 60, 600, 900, 1, true, '2026-04-06 11:29:53.474329+00'),
	('massage_deep_tissue', 'health', 'health_individual', 'health_ind_massage', 'Deep Tissue', 'Deep tissue massage', 75, 750, 1100, 2, true, '2026-04-06 11:29:53.474329+00'),
	('massage_sports', 'health', 'health_individual', 'health_ind_massage', 'Sports Massage', 'Sports massage therapy', 60, 700, 1000, 3, true, '2026-04-06 11:29:53.474329+00'),
	('physio_assessment', 'health', 'health_individual', 'health_ind_physio', 'Assessment', 'Initial assessment', 45, 500, 800, 1, true, '2026-04-06 11:29:53.474329+00'),
	('physio_treatment', 'health', 'health_individual', 'health_ind_physio', 'Treatment', 'Physio treatment session', 45, 600, 900, 2, true, '2026-04-06 11:29:53.474329+00'),
	('physio_rehab', 'health', 'health_individual', 'health_ind_physio', 'Rehabilitation', 'Rehabilitation program', 60, 700, 1000, 3, true, '2026-04-06 11:29:53.474329+00'),
	('mental_therapy', 'health', 'health_individual', 'health_ind_mental', 'Therapy', 'Therapy session', 60, 700, 1200, 1, true, '2026-04-06 11:29:53.474329+00'),
	('mental_stress', 'health', 'health_individual', 'health_ind_mental', 'Stress Management', 'Stress management coaching', 45, 500, 900, 2, true, '2026-04-06 11:29:53.474329+00'),
	('group_yoga', 'health', 'health_group', 'health_grp_training', 'Yoga', 'Yoga class', 60, 200, 400, 1, true, '2026-04-06 11:29:53.474329+00'),
	('group_pilates', 'health', 'health_group', 'health_grp_training', 'Pilates', 'Pilates class', 60, 200, 400, 2, true, '2026-04-06 11:29:53.474329+00'),
	('group_hiit', 'health', 'health_group', 'health_grp_training', 'HIIT', 'High intensity training', 45, 150, 350, 3, true, '2026-04-06 11:29:53.474329+00'),
	('wellness_meditation', 'health', 'health_group', 'health_grp_wellness', 'Meditation', 'Guided meditation', 45, 150, 300, 1, true, '2026-04-06 11:29:53.474329+00'),
	('wellness_breathing', 'health', 'health_group', 'health_grp_wellness', 'Breathing', 'Breathing exercises', 30, 100, 200, 2, true, '2026-04-06 11:29:53.474329+00');


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: order_events; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: order_offers; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: provider_categories; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: provider_modes; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: provider_skills; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: provider_targets; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: ratings; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 1, false);


--
-- PostgreSQL database dump complete
--

-- \unrestrict FxHiHsKBusBwCa4O7KnR1SSvShA80jQvNlqK0uhak1q6znDOQEX9liYclVdfweP

RESET ALL;
