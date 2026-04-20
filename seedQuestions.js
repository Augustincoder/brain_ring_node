'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const Question = require('./models/Question');

const questions = [
  { questionText: "O'zbekistonning poytaxti qaysi shahar?", correctAnswer: "Toshkent", explanation: "Toshkent - O'zbekistonning poytaxti va eng yirik shahri." },
  { questionText: "Qaysi sayyora Quyosh tizimidagi eng katta sayyora hisoblanadi?", correctAnswer: "Yupiter", explanation: "Yupiter barcha boshqa sayyoralarni qo'shganda ham ulardan 2,5 barobar og'irroqdir." },
  { questionText: "Alisher Navoiy qaysi asrda yashab ijod qilgan?", correctAnswer: "15-asr", explanation: "Alisher Navoiy 1441-1501 yillarda (15-asr) yashagan." },
  { questionText: "Suvning kimyoviy formulasi qanday?", correctAnswer: "H2O", explanation: "Ikkita vodorod va bitta kislorod atomidan iborat." },
  { questionText: "Bir yilda necha kun bor? (Kabisa yilidan tashqari)", correctAnswer: "365", explanation: "Oddiy yilda 365 kun, kabisa yilida 366 kun mavjud." },
  { questionText: "Dunyodagi eng baland cho'qqi qaysi?", correctAnswer: "Everest", explanation: "Everest dengiz sathidan 8,848 metr balandlikda joylashgan." },
  { questionText: "Yerning tabiiy yo'ldoshi nima?", correctAnswer: "Oy", explanation: "Oy Yer atrofida aylanuvchi yagona tabiiy yo'ldosh." },
  { questionText: "Amir Temur qayerda tug'ilgan?", correctAnswer: "Xo'ja Ilg'or", explanation: "Amir Temur 1336-yilda Shahrisabz yaqinidagi Xo'ja Ilg'or qishlog'ida tug'ilgan." },
  { questionText: "Eng tez yuguradigan quruqlik hayvoni qaysi?", correctAnswer: "Gepard", explanation: "Gepard soatiga 120 km gacha tezlikka erisha oladi." },
  { questionText: "O'zbekiston Respublikasi Davlat madhiyasining musiqasini kim yaratgan?", correctAnswer: "Mutal Burhonov", explanation: "Shori: Abdulla Oripov, musiqasi: Mutal Burhonov." },
  { questionText: "Bir daqiqada necha soniya bor?", correctAnswer: "60", explanation: "1 daqiqa 60 soniyaga teng." },
  { questionText: "Dunyodagi eng katta okean qaysi?", correctAnswer: "Tinch okeani", explanation: "Tinch okeani yer yuzasining 30 foizini egallaydi." },
  { questionText: "O'zbek alifbosida nechta unli harf bor?", correctAnswer: "6", explanation: "a, e, i, o, u, o'" },
  { questionText: "Quyosh sistemasida nechta sayyora bor?", correctAnswer: "8", explanation: "Merkuriy, Venera, Yer, Mars, Yupiter, Saturn, Uran, Neptun." },
  { questionText: "Dunyodagi eng uzun daryo qaysi?", correctAnswer: "Nil", explanation: "Nil daryosi Afrikada joylashgan bo'lib, uzunligi 6650 km." }
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');
  await Question.deleteMany({});
  await Question.insertMany(questions);
  console.log('Seeded '+ questions.length + ' questions');
  await mongoose.disconnect();
}

seed().catch(console.error);
