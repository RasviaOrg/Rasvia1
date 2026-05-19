-- Clove Dining (restaurant_id = 64): expanded Royal Spice menu reseed.
-- Uses restaurant menu tags (meal_times) instead of legacy lunch/dinner values.

BEGIN;

DELETE FROM public.order_items
WHERE menu_item_id IN (SELECT id FROM public.menu_items WHERE restaurant_id = 64);

DELETE FROM public.party_items
WHERE menu_item_id IN (SELECT id FROM public.menu_items WHERE restaurant_id = 64);

DELETE FROM public.menu_items WHERE restaurant_id = 64;

DELETE FROM public.restaurant_menu_tags WHERE restaurant_id = 64;

INSERT INTO public.restaurant_menu_tags (
  restaurant_id, key, label, color, bg, border, enabled, position
) VALUES
(64, 'entree',       'Entree',       '#F97316', 'bg-orange-500/10',  'border-orange-500/30',  true, 0),
(64, 'appetizer',    'Appetizer',    '#22C55E', 'bg-emerald-500/10', 'border-emerald-500/30', true, 1),
(64, 'main_course',  'Main Course',  '#818CF8', 'bg-indigo-500/10',  'border-indigo-500/30',  true, 2),
(64, 'specials',     'Specials',     '#F59E0B', 'bg-amber-500/10',   'border-amber-500/30',   true, 3),
(64, 'dessert',      'Dessert',      '#EC4899', 'bg-pink-500/10',    'border-pink-500/30',    true, 4),
(64, 'beverage',     'Beverage',     '#38BDF8', 'bg-sky-500/10',     'border-sky-500/30',     true, 5),
(64, 'sides',        'Sides',        '#94A3B8', 'bg-slate-500/10',   'border-slate-500/30',   true, 6);

INSERT INTO public.menu_items (
  restaurant_id, name, description, price, is_vegetarian, is_spicy, is_halal,
  spice_level, category, meal_times, in_stock, is_available
) VALUES
-- STREET FOOD & CHAAT
(64, 'Pani Puri (Golgappa)', 'Six hollow, crispy semolina shells served with a filling of spiced chickpeas and potatoes, accompanied by a pitcher of tangy tamarind and mint-infused water to pour inside.', 8.99, true, true, false, 2, 'STREET FOOD & CHAAT', ARRAY['appetizer'], true, true),
(64, 'Samosa Chaat', 'Deconstructed vegetable samosas smashed and topped with spiced chickpea curry, cool yogurt, and a drizzle of tamarind and cilantro chutneys.', 9.99, true, true, false, 2, 'STREET FOOD & CHAAT', ARRAY['appetizer'], true, true),
(64, 'Aloo Tikki Chaat', 'Crispy, spiced potato patties pan-fried and garnished with sweetened yogurt, sev (crunchy chickpea noodles), pomegranate seeds, and duo chutneys.', 9.49, true, true, false, 2, 'STREET FOOD & CHAAT', ARRAY['appetizer'], true, true),
(64, 'Bhel Puri', 'A light, refreshing mixture of puffed rice, roasted peanuts, diced onions, tomatoes, and crisp puri pieces, tossed in a zesty tamarind sauce.', 8.49, true, false, false, 1, 'STREET FOOD & CHAAT', ARRAY['appetizer'], true, true),

-- SOUPS & SALADS
(64, 'Mulligatawny Soup', 'A rich, comforting Anglo-Indian lentil soup brewed with coconut milk, crushed black pepper, and a hint of lemon. Available with or without diced chicken.', 7.99, false, false, false, 1, 'SOUPS & SALADS', ARRAY['appetizer'], true, true),
(64, 'Tomato Dhania Shorba', 'A light, spiced tomato broth infused with fresh coriander leaves, cumin, and garlic.', 6.99, true, false, false, 0, 'SOUPS & SALADS', ARRAY['appetizer'], true, true),
(64, 'Kachumber Salad', 'A refreshing, chopped salad of cucumbers, tomatoes, red onions, and green chilies, tossed in fresh lemon juice and chaat masala.', 6.49, true, true, false, 1, 'SOUPS & SALADS', ARRAY['appetizer'], true, true),

-- SHURUWAAT (Appetizers)
(64, 'Vegetable Samosa', 'Crisp, golden, pyramid-shaped pastries stuffed with mildly spiced mashed potatoes and green peas.', 7.99, true, false, false, 0, 'SHURUWAAT (Appetizers)', ARRAY['appetizer'], true, true),
(64, 'Assorted Pakora Platter', 'A medley of onion, potato, eggplant, and cauliflower slices battered in seasoned chickpea flour and flash-fried.', 10.99, true, false, false, 1, 'SHURUWAAT (Appetizers)', ARRAY['appetizer'], true, true),
(64, 'Lasooni Gobi', 'Crispy cauliflower florets tossed in a tangy, spicy garlic-tomato glaze.', 10.99, true, true, false, 2, 'SHURUWAAT (Appetizers)', ARRAY['appetizer'], true, true),
(64, 'Fish Koliwada', 'A popular Mumbai coastal appetizer featuring chunks of white fish marinated in ginger, garlic, and red chili, deep-fried in a spiced gram flour batter.', 13.99, false, true, false, 2, 'SHURUWAAT (Appetizers)', ARRAY['appetizer'], true, true),
(64, 'Chicken 65', 'A spicy, deep-fried chicken starter originating from Chennai, tempered with curry leaves, mustard seeds, and whole red chilies.', 12.99, false, true, false, 3, 'SHURUWAAT (Appetizers)', ARRAY['appetizer'], true, true),

-- TANDOOR SE (Clay Oven Specialties)
(64, 'Tandoori Chicken', 'The classic half-chicken on the bone, steeped in a vibrant marinade of yogurt, lemon juice, turmeric, and garam masala. Served sizzling with grilled onions and bell peppers.', 18.99, false, false, false, 1, 'TANDOOR SE (Clay Oven Specialties)', ARRAY['main_course','specials'], true, true),
(64, 'Murgh Malai Kebab', 'Melt-in-your-mouth boneless chicken breast chunks marinated in a silky mixture of heavy cream, cashew paste, and mild green cardamom.', 16.99, false, false, false, 0, 'TANDOOR SE (Clay Oven Specialties)', ARRAY['main_course','specials'], true, true),
(64, 'Lamb Seekh Kebab', 'Finely minced lamb blended with fresh mint, cilantro, and warm spices, skewered and roasted over open charcoals.', 17.99, false, true, false, 2, 'TANDOOR SE (Clay Oven Specialties)', ARRAY['main_course','specials'], true, true),
(64, 'Tandoori Jhinga (Jumbo Shrimp)', 'Plump jumbo shrimp marinated in a zesty blend of yogurt, carom seeds (ajwain), and Kashmiri chili powder.', 22.99, false, true, false, 2, 'TANDOOR SE (Clay Oven Specialties)', ARRAY['main_course','specials'], true, true),
(64, 'Paneer Tikka Sizzler', 'Generous cubes of fresh Indian cottage cheese marinated in spiced yogurt, skewered with thick-cut bell peppers and red onions.', 16.99, true, false, false, 0, 'TANDOOR SE (Clay Oven Specialties)', ARRAY['main_course','specials'], true, true),

-- MURGH (Chicken Entrees)
(64, 'Murgh Makhani (Butter Chicken)', 'Tender tandoori-pulled chicken simmered in a velvety, rich tomato gravy, finished with fenugreek leaves and fresh cream.', 18.99, false, false, false, 0, 'MURGH (Chicken Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Chicken Tikka Masala', 'Char-grilled chicken cubes folded into a robust, creamy onion and tomato sauce spiced with coriander and smoked paprika.', 17.99, false, true, false, 2, 'MURGH (Chicken Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Chicken Chettinad', 'A highly aromatic, spicy South Indian curry made with roasted coconut, star anise, black stone flower, and fiery chilies.', 18.49, false, true, false, 3, 'MURGH (Chicken Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Kadai Chicken', 'Chicken tossed in a traditional iron wok (kadai) with thick-cut bell peppers, onions, tomatoes, and freshly ground coriander seeds.', 17.49, false, true, false, 2, 'MURGH (Chicken Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Chicken Saagwala', 'Boneless chicken cooked in a vibrant, spiced puree of fresh spinach, mustard greens, and a touch of cream.', 17.99, false, false, false, 1, 'MURGH (Chicken Entrees)', ARRAY['main_course','entree'], true, true),

-- GOSHT (Lamb & Goat Entrees)
(64, 'Lamb Rogan Josh', 'A Kashmiri delicacy featuring tender lamb chunks immersed in a deep, aromatic gravy of caramelized onions, yogurt, cardamom, and cloves.', 21.99, false, true, false, 2, 'GOSHT (Lamb & Goat Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Goan Vindaloo (Lamb or Goat)', 'A fiery and tangy dish from the coast of Goa. Cooked with bold red chilies, palm vinegar, garlic, and cubed potatoes. Warning: Extra Spicy.', 20.99, false, true, false, 3, 'GOSHT (Lamb & Goat Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Goat Curry (Bone-in)', 'A rustic, traditional home-style curry featuring tender bone-in goat slow-cooked in a robust onion and tomato gravy.', 21.49, false, true, false, 2, 'GOSHT (Lamb & Goat Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Keema Matar', 'Minced lamb sautéed with green peas, ginger, garlic, and a heavy hand of earthy Indian spices.', 19.99, false, true, false, 2, 'GOSHT (Lamb & Goat Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Lamb Pasanda', 'A regal, mild dish of sliced lamb cooked in a rich, creamy almond and cashew sauce, delicately perfumed with rose water.', 22.49, false, false, false, 0, 'GOSHT (Lamb & Goat Entrees)', ARRAY['main_course','entree'], true, true),

-- SAMUNDARI KHAZANA (Seafood)
(64, 'Goan Fish Curry', 'Mahi-mahi simmered in a golden, tangy coconut milk broth infused with tamarind, turmeric, and mustard seeds.', 21.99, false, true, false, 2, 'SAMUNDARI KHAZANA (Seafood)', ARRAY['main_course','entree'], true, true),
(64, 'Kerala Shrimp Roast', 'Shrimp pan-roasted with a thick, semi-dry spice paste made of caramelized shallots, curry leaves, and black pepper.', 22.99, false, true, false, 2, 'SAMUNDARI KHAZANA (Seafood)', ARRAY['main_course','entree'], true, true),
(64, 'Fish Tikka Masala', 'Tandoor-grilled fish filets gently folded into our signature creamy tomato-onion masala sauce.', 20.99, false, false, false, 1, 'SAMUNDARI KHAZANA (Seafood)', ARRAY['main_course','entree'], true, true),

-- SABZI BAAZAR (Vegetarian & Vegan Entrees)
(64, 'Palak Paneer', 'Soft cottage cheese cubes folded into a vibrant, mildly spiced puree of fresh spinach and garlic.', 15.99, true, false, false, 0, 'SABZI BAAZAR (Vegetarian & Vegan Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Malai Kofta', 'Melt-in-your-mouth dumplings made from paneer, potatoes, and crushed nuts, simmered gently in a rich, creamy cashew gravy.', 16.99, true, false, false, 0, 'SABZI BAAZAR (Vegetarian & Vegan Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Dal Makhani', 'Whole black lentils and red kidney beans slow-cooked overnight over charcoal, finished with butter and fresh cream.', 14.99, true, false, false, 0, 'SABZI BAAZAR (Vegetarian & Vegan Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Yellow Dal Tadka (Vegan)', 'Yellow split pigeon peas cooked until soft, tempered with ghee, cumin, dried red chilies, and garlic.', 13.99, true, false, false, 1, 'SABZI BAAZAR (Vegetarian & Vegan Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Bhindi Masala (Vegan)', 'Fresh okra tossed with diced onions, tomatoes, dry mango powder (amchur), and roasted cumin.', 14.49, true, true, false, 2, 'SABZI BAAZAR (Vegetarian & Vegan Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Navratan Korma', 'A "nine-gem" curry featuring a medley of vegetables, fruits, and nuts cooked in a mild, sweet, and creamy sauce.', 15.49, true, false, false, 0, 'SABZI BAAZAR (Vegetarian & Vegan Entrees)', ARRAY['main_course','entree'], true, true),
(64, 'Baingan Bharta', 'Whole eggplants roasted over an open flame for a smoky flavor, mashed and sautéed with tomatoes, onions, and fresh cilantro.', 14.99, true, false, false, 1, 'SABZI BAAZAR (Vegetarian & Vegan Entrees)', ARRAY['main_course','entree'], true, true),

-- INDO-CHINESE FUSION
(64, 'Gobi Manchurian', 'Crispy cauliflower florets tossed in a dark, umami-rich soy, garlic, and ginger sauce.', 14.99, true, true, false, 2, 'INDO-CHINESE FUSION', ARRAY['main_course','entree'], true, true),
(64, 'Chili Paneer', 'Cubes of fried paneer wok-tossed with green chilies, bell peppers, onions, and a spicy, tangy sauce.', 15.99, true, true, false, 3, 'INDO-CHINESE FUSION', ARRAY['main_course','entree'], true, true),
(64, 'Hakka Noodles (Veg or Chicken)', 'Thin noodles stir-fried in a very hot wok with shredded cabbage, carrots, soy sauce, and white pepper.', 14.49, false, false, false, 1, 'INDO-CHINESE FUSION', ARRAY['main_course','entree'], true, true),

-- CHAWAL & BIRYANI (Rice Specialties)
(64, 'Hyderabadi Goat Biryani (Bone-in)', 'A robust, highly spiced rice dish layered with tender, bone-in goat, fresh green chilies, and fried onions. Served with cooling cucumber raita.', 22.99, false, true, false, 2, 'CHAWAL & BIRYANI (Rice Specialties)', ARRAY['main_course','specials'], true, true),
(64, 'Awadhi Chicken Biryani', 'Basmati rice layered with yogurt-marinated chicken, caramelized onions, and kewra water. Served with cooling cucumber raita.', 19.99, false, false, false, 1, 'CHAWAL & BIRYANI (Rice Specialties)', ARRAY['main_course','specials'], true, true),
(64, 'Vegetable Biryani', 'A garden medley of carrots, peas, potatoes, and cauliflower layered with saffron-infused basmati rice. Served with cooling cucumber raita.', 16.99, true, false, false, 0, 'CHAWAL & BIRYANI (Rice Specialties)', ARRAY['main_course','specials'], true, true),
(64, 'Lemon & Peanut Rice', 'Basmati rice tossed with fresh lemon juice, roasted peanuts, curry leaves, and mustard seeds.', 7.99, true, false, false, 0, 'CHAWAL & BIRYANI (Rice Specialties)', ARRAY['sides'], true, true),
(64, 'Jeera Rice', 'Premium, long-grain basmati rice tempered with toasted cumin seeds.', 5.99, true, false, false, 0, 'CHAWAL & BIRYANI (Rice Specialties)', ARRAY['sides'], true, true),

-- NAAN BAKEHOUSE (Breads)
(64, 'Naan (Plain or Butter)', 'Soft, naturally leavened white flour flatbread baked fresh to order in our clay tandoor.', 3.99, true, false, false, 0, 'NAAN BAKEHOUSE (Breads)', ARRAY['sides'], true, true),
(64, 'Garlic & Cilantro Naan', 'Brushed with melted butter, minced garlic, and cilantro.', 4.99, true, false, false, 0, 'NAAN BAKEHOUSE (Breads)', ARRAY['sides'], true, true),
(64, 'Chili Cheese Naan', 'Stuffed with melted mozzarella and fiery chopped green chilies.', 5.99, true, true, false, 2, 'NAAN BAKEHOUSE (Breads)', ARRAY['sides'], true, true),
(64, 'Peshawari Naan', 'A sweet bread stuffed with a fine paste of coconut, raisins, and pistachios.', 5.99, true, false, false, 0, 'NAAN BAKEHOUSE (Breads)', ARRAY['sides'], true, true),
(64, 'Keema Naan', 'Stuffed with heavily spiced minced lamb.', 6.99, false, true, false, 2, 'NAAN BAKEHOUSE (Breads)', ARRAY['sides'], true, true),
(64, 'Tandoori Roti', 'A simple, unleavened whole wheat flatbread.', 3.49, true, false, false, 0, 'NAAN BAKEHOUSE (Breads)', ARRAY['sides'], true, true),
(64, 'Lachha Paratha', 'A flaky, multi-layered, buttery whole wheat bread.', 5.49, true, false, false, 0, 'NAAN BAKEHOUSE (Breads)', ARRAY['sides'], true, true),
(64, 'Bhatura', 'A large, puffy, deep-fried bread (perfect with Chana Masala).', 4.99, true, false, false, 0, 'NAAN BAKEHOUSE (Breads)', ARRAY['sides'], true, true),

-- SIDES & CONDIMENTS
(64, 'Cucumber Raita', 'A cooling yogurt relish with grated cucumber and roasted cumin.', 4.99, true, false, false, 0, 'SIDES & CONDIMENTS', ARRAY['sides'], true, true),
(64, 'Mango Chutney', 'A sweet and tangy preserve made from green mangoes.', 3.99, true, false, false, 0, 'SIDES & CONDIMENTS', ARRAY['sides'], true, true),
(64, 'Papadum', 'Three crisp, wafer-thin lentil crackers served with mint and tamarind dips.', 3.49, true, false, false, 0, 'SIDES & CONDIMENTS', ARRAY['sides'], true, true),
(64, 'Achaar (Mixed Pickle)', 'A spicy, salty, and sour condiment made of pickled mangoes, limes, and chilies.', 3.99, true, true, false, 2, 'SIDES & CONDIMENTS', ARRAY['sides'], true, true),

-- MEETHA (Desserts)
(64, 'Gulab Jamun', 'Warm, golden, deep-fried milk dumplings soaked in a fragrant rose and cardamom sugar syrup.', 6.99, true, false, false, 0, 'MEETHA (Desserts)', ARRAY['dessert'], true, true),
(64, 'Rasmalai', 'Delicate, spongy paneer patties immersed in chilled, thickened whole milk infused with saffron.', 7.99, true, false, false, 0, 'MEETHA (Desserts)', ARRAY['dessert'], true, true),
(64, 'Gajar Ka Halwa', 'A rich, warm dessert made from freshly grated carrots slow-cooked in milk, ghee, sugar, and cardamom.', 7.49, true, false, false, 0, 'MEETHA (Desserts)', ARRAY['dessert'], true, true),
(64, 'Rice Kheer', 'Traditional Indian rice pudding simmered with milk, almonds, and golden raisins.', 6.49, true, false, false, 0, 'MEETHA (Desserts)', ARRAY['dessert'], true, true),
(64, 'Mango Kulfi', 'Dense, traditional Indian ice cream made with reduced milk and sweet Alphonso mango puree.', 6.49, true, false, false, 0, 'MEETHA (Desserts)', ARRAY['dessert'], true, true),

-- PEY (Beverages)
(64, 'Mango Lassi', 'A classic, refreshing yogurt smoothie blended with sweet mango pulp.', 5.99, true, false, false, 0, 'PEY (Beverages)', ARRAY['beverage'], true, true),
(64, 'Sweet or Salted Lassi', 'The traditional yogurt drink, flavored with either rosewater and sugar, or roasted cumin and black salt.', 4.99, true, false, false, 0, 'PEY (Beverages)', ARRAY['beverage'], true, true),
(64, 'Masala Chai', 'Indian black tea brewed with milk, crushed cardamom, ginger, cloves, and cinnamon. Served hot.', 3.99, true, false, false, 0, 'PEY (Beverages)', ARRAY['beverage'], true, true),
(64, 'Madras Filter Coffee', 'Strong South Indian coffee brewed with chicory and frothed with hot milk.', 4.49, true, false, false, 0, 'PEY (Beverages)', ARRAY['beverage'], true, true),
(64, 'Fresh Lime Soda', 'Freshly squeezed lime juice with sparkling water, available sweet, salted, or mixed.', 4.49, true, false, false, 0, 'PEY (Beverages)', ARRAY['beverage'], true, true),
(64, 'Thums Up / Limca', 'Imported Indian sodas (Spiced Cola / Cloudy Lemon-Lime).', 3.49, true, false, false, 0, 'PEY (Beverages)', ARRAY['beverage'], true, true);

UPDATE public.restaurants
SET
  is_enabled = true,
  is_coming_soon = false,
  waitlist_open = true,
  is_waitlist_open = true,
  is_featured = true,
  description = 'The Royal Spice — a taste of India featuring street food chaat, tandoor specialties, regional curries, Indo-Chinese fusion, seafood, biryanis, and classic breads. All curries and entrees served with complimentary Basmati rice.',
  cuisine_tags = ARRAY['Indian', 'North Indian', 'South Indian', 'Street Food', 'Seafood', 'Indo-Chinese', 'Tandoor', 'Biryani'],
  price_range = '$$'
WHERE id = 64;

COMMIT;
