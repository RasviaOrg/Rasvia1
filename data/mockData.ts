export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  cuisineCategory: string;
  rating: number;
  reviewCount: number;
  distance: string;
  waitTime: number; // in minutes
  waitStatus: "green" | "amber" | "red";
  capacity: number;
  partySize: number;
  image: string;
  priceRange: string;
  address: string;
  description: string;
  tags: string[];
  queueLength: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  isPopular: boolean;
  isVegetarian: boolean;
  spiceLevel: number;
  mealTimes: string[];
}

export interface CartItem extends MenuItem {
  quantity: number;
  addedBy?: GroupMember;
}

export interface GroupMember {
  id: string;
  name: string;
  avatar: string;
  color: string;
}

export const groupMembers: GroupMember[] = [
  { id: "1", name: "You", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&q=80", color: "#FF9933" },
  { id: "2", name: "Priya", avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&q=80", color: "#22C55E" },
  { id: "3", name: "Arjun", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80", color: "#3B82F6" },
];

export const restaurants: Restaurant[] = [
  {
    id: "1",
    name: "Saffron Palace",
    cuisine: "North Indian • Mughlai",
    cuisineCategory: "North Indian",
    rating: 4.8,
    reviewCount: 2847,
    distance: "0.3 mi",
    waitTime: 12,
    waitStatus: "green",
    capacity: 85,
    partySize: 4,
    image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80",
    priceRange: "$$$",
    address: "142 Curry Lane, Downtown",
    description: "An award-winning Mughlai restaurant renowned for its tandoori preparations and rich curries, set in a palatial dining room with intricate gold leaf detailing.",
    tags: ["Fine Dining", "Tandoori", "Cocktails"],
    queueLength: 4,
  },
  {
    id: "2",
    name: "Bombay Social",
    cuisine: "Street Food • Fusion",
    cuisineCategory: "North Indian",
    rating: 4.6,
    reviewCount: 1923,
    distance: "0.5 mi",
    waitTime: 25,
    waitStatus: "amber",
    capacity: 60,
    partySize: 2,
    image: "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=800&q=80",
    priceRange: "$$",
    address: "88 Spice Market Blvd",
    description: "Elevated street food with a modern twist. Think deconstructed pani puri, truffle naan, and craft cocktails inspired by Mumbai's vibrant nightlife.",
    tags: ["Casual", "Craft Cocktails", "Fusion"],
    queueLength: 8,
  },
  {
    id: "3",
    name: "Dosa Republic",
    cuisine: "South Indian • Vegetarian",
    cuisineCategory: "South Indian",
    rating: 4.9,
    reviewCount: 3201,
    distance: "0.8 mi",
    waitTime: 45,
    waitStatus: "red",
    capacity: 45,
    partySize: 6,
    image: "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&q=80",
    priceRange: "$$",
    address: "55 Temple Row",
    description: "A vegetarian paradise celebrating the art of the dosa. Over 40 varieties, from classic masala to avant-garde truffle ghee roast, served on banana leaves.",
    tags: ["Vegetarian", "Traditional", "Family"],
    queueLength: 15,
  },
  {
    id: "4",
    name: "Chai & Charcoal",
    cuisine: "Pakistani • BBQ",
    cuisineCategory: "Pakistani",
    rating: 4.7,
    reviewCount: 1567,
    distance: "1.2 mi",
    waitTime: 8,
    waitStatus: "green",
    capacity: 70,
    partySize: 4,
    image: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&q=80",
    priceRange: "$$",
    address: "301 Grill Avenue",
    description: "Authentic Pakistani charcoal grilling meets modern ambiance. Succulent kebabs, handmade naan fresh from the tandoor, and signature masala chai.",
    tags: ["BBQ", "Late Night", "Outdoor"],
    queueLength: 3,
  },
  {
    id: "5",
    name: "Lanka Spice House",
    cuisine: "Sri Lankan • Seafood",
    cuisineCategory: "Sri Lankan",
    rating: 4.5,
    reviewCount: 987,
    distance: "1.5 mi",
    waitTime: 18,
    waitStatus: "amber",
    capacity: 40,
    partySize: 2,
    image: "https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=800&q=80",
    priceRange: "$$$",
    address: "77 Harbor Walk",
    description: "Coastal Sri Lankan cuisine featuring freshly caught seafood, fiery sambols, and traditional hoppers in an oceanfront setting.",
    tags: ["Seafood", "Waterfront", "Spicy"],
    queueLength: 6,
  },
  {
    id: "6",
    name: "Naan & Beyond",
    cuisine: "Indo-Chinese • Bar",
    cuisineCategory: "Indo-Chinese",
    rating: 4.4,
    reviewCount: 1345,
    distance: "0.7 mi",
    waitTime: 5,
    waitStatus: "green",
    capacity: 90,
    partySize: 8,
    image: "https://images.unsplash.com/photo-1590846406792-0adc7f938f1d?w=800&q=80",
    priceRange: "$$",
    address: "210 Fusion Drive",
    description: "Where Indian spices meet Chinese technique. Chilli paneer, hakka noodles, and manchurian served in a vibrant neon-lit bar setting.",
    tags: ["Indo-Chinese", "Bar", "Groups"],
    queueLength: 2,
  },
];

export const menuItems: MenuItem[] = [
  {
    id: "m1",
    name: "Butter Chicken",
    description: "Tender tandoori chicken in rich tomato-butter cream sauce with fenugreek",
    price: 24.99,
    image: "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=600&q=80",
    category: "Mains",
    isPopular: true,
    isVegetarian: false,
    spiceLevel: 2,
    mealTimes: ["special", "dinner"],
  },
  {
    id: "m2",
    name: "Lamb Biryani",
    description: "Fragrant basmati layered with slow-cooked lamb, saffron, and crispy onions",
    price: 28.99,
    image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&q=80",
    category: "Mains",
    isPopular: true,
    isVegetarian: false,
    spiceLevel: 3,
    mealTimes: ["lunch", "dinner"],
  },
  {
    id: "m3",
    name: "Paneer Tikka",
    description: "Charcoal-grilled cottage cheese marinated in saffron yogurt and spices",
    price: 18.99,
    image: "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=600&q=80",
    category: "Starters",
    isPopular: true,
    isVegetarian: true,
    spiceLevel: 2,
    mealTimes: ["special"],
  },
  {
    id: "m4",
    name: "Garlic Naan",
    description: "Wood-fired flatbread brushed with garlic butter and fresh cilantro",
    price: 6.99,
    image: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=600&q=80",
    category: "Breads",
    isPopular: false,
    isVegetarian: true,
    spiceLevel: 0,
    mealTimes: ["lunch", "dinner"],
  },
  {
    id: "m5",
    name: "Masala Dosa",
    description: "Crispy rice crepe filled with spiced potato masala, served with chutneys",
    price: 16.99,
    image: "https://images.unsplash.com/photo-1668236543090-82eba5ee5976?w=600&q=80",
    category: "South Indian",
    isPopular: true,
    isVegetarian: true,
    spiceLevel: 2,
    mealTimes: ["lunch"],
  },
  {
    id: "m6",
    name: "Seekh Kebab",
    description: "Hand-minced lamb kebab with green chutney and pickled onions",
    price: 21.99,
    image: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=600&q=80",
    category: "Starters",
    isPopular: false,
    isVegetarian: false,
    spiceLevel: 3,
    mealTimes: ["special", "dinner"],
  },
  {
    id: "m7",
    name: "Mango Lassi",
    description: "Creamy yogurt blended with Alphonso mango puree and cardamom",
    price: 8.99,
    image: "https://images.unsplash.com/photo-1527661591475-527312dd65f5?w=600&q=80",
    category: "Drinks",
    isPopular: true,
    isVegetarian: true,
    spiceLevel: 0,
    mealTimes: ["breakfast", "lunch"],
  },
  {
    id: "m8",
    name: "Gulab Jamun",
    description: "Warm milk-solid dumplings soaked in rose-cardamom sugar syrup",
    price: 10.99,
    image: "https://images.unsplash.com/photo-1666190100685-abb6346d5ed3?w=600&q=80",
    category: "Desserts",
    isPopular: false,
    isVegetarian: true,
    spiceLevel: 0,
    mealTimes: ["special"],
  },
  {
    id: "m9",
    name: "Chicken Tikka Masala",
    description: "Smoky chicken pieces in creamy spiced tomato sauce with charred capsicum",
    price: 22.99,
    image: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=600&q=80",
    category: "Mains",
    isPopular: true,
    isVegetarian: false,
    spiceLevel: 2,
    mealTimes: ["dinner"],
  },
  {
    id: "m10",
    name: "Samosa Chaat",
    description: "Crispy samosas topped with tangy tamarind, yogurt, and crunchy sev",
    price: 12.99,
    image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600&q=80",
    category: "Starters",
    isPopular: true,
    isVegetarian: true,
    spiceLevel: 1,
    mealTimes: ["lunch", "special"],
  },
];

export const appetizers: MenuItem[] = [
  menuItems[2], // Paneer Tikka
  menuItems[5], // Seekh Kebab
  menuItems[9], // Samosa Chaat
  menuItems[3], // Garlic Naan
  menuItems[6], // Mango Lassi
];

export type FilterType = "all" | "green" | "amber" | "red";
export type SortType = "wait" | "rating" | "distance";
