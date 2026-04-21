const mongoose = require('mongoose');
require('dotenv').config();

const QuestionSchema = new mongoose.Schema({
    questionText: String,
    correctAnswer: String
}, { strict: false });

const Question = mongoose.models.Question || mongoose.model('Question', QuestionSchema);

async function check(id) {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const question = await Question.findById(id);
        if (question) {
            console.log('FOUND:', question.questionText);
        } else {
            console.log('NOT FOUND id:', id);
        }
        await mongoose.connection.close();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

const id = process.argv[2];
if (!id) {
    console.log('Usage: node check_id.js <id>');
    process.exit(1);
}
check(id);
