const mongoose = require('mongoose');
require('dotenv').config();

const QuestionSchema = new mongoose.Schema({
    questionText: String,
    correctAnswer: String
}, { strict: false });

const Question = mongoose.models.Question || mongoose.model('Question', QuestionSchema);

async function check() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/brain-ring');
        const questions = await Question.find().limit(5);
        console.log('Sample Questions:');
        questions.forEach(q => {
            console.log(`ID: ${q._id}, Text: ${q.questionText?.substring(0, 20)}...`);
        });
        await mongoose.connection.close();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
