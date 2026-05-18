-- Clove Dining (restaurant_id = 64): replace test menu, enable on app + dashboard.

BEGIN;

-- Clear historical line items tied to old test dishes (test data only).
DELETE FROM public.order_items
WHERE menu_item_id IN (SELECT id FROM public.menu_items WHERE restaurant_id = 64);

DELETE FROM public.party_items
WHERE menu_item_id IN (SELECT id FROM public.menu_items WHERE restaurant_id = 64);

DELETE FROM public.menu_items WHERE restaurant_id = 64;

INSERT INTO public.menu_items (
  restaurant_id, name, description, price, is_vegetarian, is_spicy, is_halal,
  spice_level, category, meal_times, in_stock, is_available
) VALUES
-- SHURUWAAT (Appetizers)
(64, 'Vegetable Samosa', 'Two crisp, golden, pyramid-shaped pastries stuffed with a mildly spiced mixture of mashed potatoes, green peas, and toasted coriander seeds. Served with tamarind and mint chutneys.', 8.99, true, false, false, 0, 'SHURUWAAT (Appetizers)', ARRAY['lunch','dinner'], true, true),
(64, 'Onion Bhaji', 'Thinly sliced onions coated in a seasoned chickpea flour batter, flash-fried until perfectly crispy. A classic Indian street food favorite.', 7.99, true, false, false, 0, 'SHURUWAAT (Appetizers)', ARRAY['lunch','dinner'], true, true),
(64, 'Lasooni Gobi', 'Crispy cauliflower florets tossed in a tangy and spicy garlic-tomato glaze, finished with fresh cilantro and toasted sesame seeds.', 10.99, true, true, false, 2, 'SHURUWAAT (Appetizers)', ARRAY['lunch','dinner'], true, true),
(64, 'Chicken Tikka Starter', 'Bite-sized pieces of boneless chicken breast marinated overnight in thick yogurt, Kashmiri chili, and ginger-garlic paste, charred in the tandoor.', 12.99, false, true, false, 2, 'SHURUWAAT (Appetizers)', ARRAY['lunch','dinner'], true, true),
(64, 'Lamb Seekh Kebab', 'Finely minced lamb blended with fresh mint, cilantro, green chilies, and warm spices, skewered and roasted over open charcoals.', 13.99, false, true, false, 2, 'SHURUWAAT (Appetizers)', ARRAY['lunch','dinner'], true, true),

-- TANDOOR SE (Clay Oven Specialties)
(64, 'Tandoori Chicken', 'The classic half-chicken on the bone, steeped in a vibrant marinade of yogurt, lemon juice, turmeric, and our house-blended garam masala. Served sizzling with grilled onions and bell peppers.', 18.99, false, false, false, 1, 'TANDOOR SE (Clay Oven Specialties)', ARRAY['lunch','dinner'], true, true),
(64, 'Tandoori Salmon', 'Thick-cut Atlantic salmon filets marinated in mustard oil, ajwain (carom seeds), and yogurt, grilled to achieve a smoky crust and tender center. Served sizzling with grilled onions and bell peppers.', 24.99, false, false, false, 1, 'TANDOOR SE (Clay Oven Specialties)', ARRAY['lunch','dinner'], true, true),
(64, 'Paneer Tikka Sizzler', 'Generous cubes of fresh Indian cottage cheese marinated in spiced yogurt, skewered with thick-cut bell peppers and red onions. Served sizzling with grilled onions and bell peppers.', 16.99, true, false, false, 0, 'TANDOOR SE (Clay Oven Specialties)', ARRAY['lunch','dinner'], true, true),

-- MURGH & GOSHT (Poultry & Meat Entrees)
(64, 'Murgh Makhani (Butter Chicken)', 'Tender tandoori-pulled chicken simmered in a velvety, rich tomato gravy, finished with fenugreek leaves, fresh cream, and a dollop of butter.', 18.99, false, false, false, 0, 'MURGH & GOSHT (Poultry & Meat Entrees)', ARRAY['lunch','dinner'], true, true),
(64, 'Chicken Tikka Masala', 'Char-grilled chicken cubes folded into a robust, creamy onion and tomato sauce spiced with coriander, cumin, and smoked paprika.', 17.99, false, true, false, 2, 'MURGH & GOSHT (Poultry & Meat Entrees)', ARRAY['lunch','dinner'], true, true),
(64, 'Lamb Rogan Josh', 'A Kashmiri delicacy featuring tender, slow-cooked lamb chunks immersed in a deep, aromatic gravy of caramelized onions, yogurt, cardamom, and cloves.', 21.99, false, true, false, 2, 'MURGH & GOSHT (Poultry & Meat Entrees)', ARRAY['lunch','dinner'], true, true),
(64, 'Goan Vindaloo', 'A fiery and tangy dish from the coast of Goa. Choice of chicken, lamb, or shrimp with bold red chilies, palm vinegar, garlic, and cubed potatoes. Extra spicy.', 19.99, false, true, false, 3, 'MURGH & GOSHT (Poultry & Meat Entrees)', ARRAY['lunch','dinner'], true, true),
(64, 'Chicken Korma', 'A luxurious, mild curry made with a base of ground cashews, almonds, and heavy cream, delicately perfumed with rose water and green cardamom.', 17.99, false, false, false, 0, 'MURGH & GOSHT (Poultry & Meat Entrees)', ARRAY['lunch','dinner'], true, true),

-- SABZI BAAZAR (Vegetarian Entrees)
(64, 'Palak Paneer', 'Soft, homemade cottage cheese cubes folded into a vibrant, mildly spiced puree of fresh spinach, garlic, and a touch of cream.', 15.99, true, false, false, 0, 'SABZI BAAZAR (Vegetarian Entrees)', ARRAY['lunch','dinner'], true, true),
(64, 'Malai Kofta', 'Melt-in-your-mouth dumplings made from paneer, potatoes, and crushed nuts, simmered gently in a rich, creamy cashew and onion gravy.', 16.99, true, false, false, 0, 'SABZI BAAZAR (Vegetarian Entrees)', ARRAY['lunch','dinner'], true, true),
(64, 'Dal Makhani', 'The quintessential Punjabi comfort food. Whole black lentils and red kidney beans slow-cooked overnight over charcoal, finished with butter and fresh cream.', 14.99, true, false, false, 0, 'SABZI BAAZAR (Vegetarian Entrees)', ARRAY['lunch','dinner'], true, true),
(64, 'Baingan Bharta', 'Whole eggplants roasted over an open flame for a distinct smoky flavor, then mashed and sautéed with chopped tomatoes, onions, garlic, and fresh cilantro.', 14.99, true, false, false, 0, 'SABZI BAAZAR (Vegetarian Entrees)', ARRAY['lunch','dinner'], true, true),
(64, 'Chana Masala', 'Plump white chickpeas slow-cooked in a tart and spicy sauce of tomatoes, ginger, and dry mango powder.', 13.99, true, true, false, 2, 'SABZI BAAZAR (Vegetarian Entrees)', ARRAY['lunch','dinner'], true, true),

-- CHAWAL (Rice & Biryani)
(64, 'Awadhi Chicken Biryani', 'Fragrant basmati rice layered with yogurt-marinated chicken, caramelized onions, and kewra water. Served with cooling cucumber raita.', 19.99, false, false, false, 1, 'CHAWAL (Rice & Biryani)', ARRAY['lunch','dinner'], true, true),
(64, 'Hyderabadi Lamb Biryani', 'A robust, highly spiced rice dish layered with tender, bone-in lamb, fresh green chilies, and fried onions. Served with cooling cucumber raita.', 22.99, false, true, false, 2, 'CHAWAL (Rice & Biryani)', ARRAY['lunch','dinner'], true, true),
(64, 'Vegetable Biryani', 'A garden medley of carrots, peas, potatoes, and cauliflower layered with saffron-infused basmati rice. Served with cooling cucumber raita.', 16.99, true, false, false, 0, 'CHAWAL (Rice & Biryani)', ARRAY['lunch','dinner'], true, true),
(64, 'Jeera Rice', 'Premium, long-grain basmati rice tempered with toasted cumin seeds and a hint of ghee.', 5.99, true, false, false, 0, 'CHAWAL (Rice & Biryani)', ARRAY['lunch','dinner'], true, true),

-- NAAN BAKEHOUSE (Breads)
(64, 'Naan (Plain or Butter)', 'Soft, naturally leavened white flour flatbread with a blistered, chewy exterior. Baked fresh to order in our clay tandoor.', 3.99, true, false, false, 0, 'NAAN BAKEHOUSE (Breads)', ARRAY['lunch','dinner'], true, true),
(64, 'Garlic & Cilantro Naan', 'Our classic naan brushed with melted butter, minced fresh garlic, and cilantro.', 4.99, true, false, false, 0, 'NAAN BAKEHOUSE (Breads)', ARRAY['lunch','dinner'], true, true),
(64, 'Peshawari Naan', 'A sweet, dessert-like bread stuffed with a fine paste of coconut, raisins, almonds, and pistachios.', 5.99, true, false, false, 0, 'NAAN BAKEHOUSE (Breads)', ARRAY['lunch','dinner'], true, true),
(64, 'Tandoori Roti', 'A simple, hearty, unleavened whole wheat flatbread.', 3.49, true, false, false, 0, 'NAAN BAKEHOUSE (Breads)', ARRAY['lunch','dinner'], true, true),
(64, 'Aloo Paratha', 'Flaky, multi-layered whole wheat bread stuffed with a seasoned potato mixture.', 5.49, true, false, false, 0, 'NAAN BAKEHOUSE (Breads)', ARRAY['lunch','dinner'], true, true),

-- SIDES & CONDIMENTS
(64, 'Cucumber Raita', 'A cooling yogurt relish with grated cucumber and roasted cumin.', 4.99, true, false, false, 0, 'SIDES & CONDIMENTS', ARRAY['lunch','dinner'], true, true),
(64, 'Mango Chutney', 'A sweet and tangy preserve made from green mangoes.', 3.99, true, false, false, 0, 'SIDES & CONDIMENTS', ARRAY['lunch','dinner'], true, true),
(64, 'Papadum', 'Three crisp, wafer-thin lentil crackers served with mint and tamarind dips.', 3.49, true, false, false, 0, 'SIDES & CONDIMENTS', ARRAY['lunch','dinner'], true, true),
(64, 'Achaar (Mixed Pickle)', 'A spicy, salty, and sour condiment made of pickled mangoes, limes, and chilies.', 3.99, true, true, false, 2, 'SIDES & CONDIMENTS', ARRAY['lunch','dinner'], true, true),

-- MEETHA (Desserts)
(64, 'Gulab Jamun', 'Warm, golden, deep-fried milk dumplings soaked in a fragrant rose and cardamom sugar syrup.', 6.99, true, false, false, 0, 'MEETHA (Desserts)', ARRAY['lunch','dinner'], true, true),
(64, 'Rasmalai', 'Delicate, spongy paneer patties immersed in chilled, thickened whole milk infused with saffron and garnished with crushed pistachios.', 7.99, true, false, false, 0, 'MEETHA (Desserts)', ARRAY['lunch','dinner'], true, true),
(64, 'Mango Kulfi', 'Dense, traditional Indian ice cream made with reduced milk and sweet Alphonso mango puree.', 6.49, true, false, false, 0, 'MEETHA (Desserts)', ARRAY['lunch','dinner'], true, true),

-- PEY (Beverages)
(64, 'Mango Lassi', 'A classic, refreshing yogurt smoothie blended with sweet mango pulp.', 5.99, true, false, false, 0, 'PEY (Beverages)', ARRAY['lunch','dinner'], true, true),
(64, 'Masala Chai', 'Indian black tea brewed with milk, crushed cardamom, ginger, cloves, and cinnamon. Served hot.', 3.99, true, false, false, 0, 'PEY (Beverages)', ARRAY['lunch','dinner'], true, true),
(64, 'Thums Up / Limca', 'Imported, popular Indian sodas (spiced cola or cloudy lemon-lime).', 3.49, true, false, false, 0, 'PEY (Beverages)', ARRAY['lunch','dinner'], true, true);

UPDATE public.restaurants
SET
  is_enabled = true,
  is_coming_soon = false,
  waitlist_open = true,
  is_waitlist_open = true,
  is_featured = true,
  description = 'Indian fine-dining experience featuring tandoor specialties, biryanis, and classic North Indian curries.',
  cuisine_tags = ARRAY['Indian', 'North Indian', 'Fine Dining', 'Tandoor', 'Biryani'],
  price_range = '$$'
WHERE id = 64;

COMMIT;
