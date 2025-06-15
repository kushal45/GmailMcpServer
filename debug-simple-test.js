// Simple diagnostic test - standalone analysis
console.log('=== POLICY VS EMAIL ANALYSIS ===');

const emails = [
  {
    id: "deletable-spam-1",
    category: "low",
    date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days old
    spam_score: 0.9,
    promotional_score: 0.8,
    importanceScore: 1
  },
  {
    id: "deletable-promo-1", 
    category: "low",
    date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days old
    spam_score: 0.7,
    promotional_score: 0.9,
    importanceScore: 2
  },
  {
    id: "deletable-old-1",
    category: "medium",
    date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days old
    spam_score: 0.3,
    promotional_score: 0.4,
    importanceScore: 4
  }
];

const policy = {
  criteria: {
    age_days_min: 14,           // Must be >= 14 days old
    importance_level_max: "medium", // Must be "low" or "medium" 
    spam_score_min: 0.5,        // Must be >= 0.5
    promotional_score_min: 0.6   // Must be >= 0.6
  }
};

console.log('Policy criteria:', policy.criteria);
console.log('\nEmail analysis:');

emails.forEach((email, i) => {
  const ageDays = Math.floor((Date.now() - email.date.getTime()) / (24 * 60 * 60 * 1000));
  const matchesAge = ageDays >= policy.criteria.age_days_min;
  const matchesImportance = email.category === 'low' || (email.category === 'medium' && policy.criteria.importance_level_max === 'medium');
  const matchesSpam = email.spam_score >= policy.criteria.spam_score_min;
  const matchesPromo = email.promotional_score >= policy.criteria.promotional_score_min;
  
  console.log(`Email ${i+1} (${email.id}):`);
  console.log(`  Age: ${ageDays} days (needs >= ${policy.criteria.age_days_min}) ${matchesAge ? '✅' : '❌'}`);
  console.log(`  Category: ${email.category} (max: ${policy.criteria.importance_level_max}) ${matchesImportance ? '✅' : '❌'}`);
  console.log(`  Spam: ${email.spam_score} (needs >= ${policy.criteria.spam_score_min}) ${matchesSpam ? '✅' : '❌'}`);
  console.log(`  Promo: ${email.promotional_score} (needs >= ${policy.criteria.promotional_score_min}) ${matchesPromo ? '✅' : '❌'}`);
  console.log(`  SHOULD MATCH: ${matchesAge && matchesImportance && matchesSpam && matchesPromo ? '✅ YES' : '❌ NO'}`);
  console.log('');
});

console.log('\n=== SUMMARY ===');
const matchingEmails = emails.filter(email => {
  const ageDays = Math.floor((Date.now() - email.date.getTime()) / (24 * 60 * 60 * 1000));
  const matchesAge = ageDays >= policy.criteria.age_days_min;
  const matchesImportance = email.category === 'low' || (email.category === 'medium' && policy.criteria.importance_level_max === 'medium');
  const matchesSpam = email.spam_score >= policy.criteria.spam_score_min;
  const matchesPromo = email.promotional_score >= policy.criteria.promotional_score_min;
  return matchesAge && matchesImportance && matchesSpam && matchesPromo;
});

console.log(`Expected matching emails: ${matchingEmails.length}`);
console.log(`Matching email IDs: [${matchingEmails.map(e => e.id).join(', ')}]`);
console.log(`\nTest expects: 2-3 emails to be deleted`);
console.log(`Logic expects: ${matchingEmails.length} emails to match`);
console.log(`\nThe issue: ${matchingEmails.length === 0 ? '❌ NO EMAILS MATCH THE CRITERIA!' : matchingEmails.length >= 2 ? '✅ Should work' : '⚠️ Only 1 email matches'}`);