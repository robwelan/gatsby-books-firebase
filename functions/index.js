const functions = require('firebase-functions');
const admin = require('firebase-admin');
const mimeTypes = require('mimetypes');

const collections = require('./constants-collections');

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });
admin.initializeApp();

function checkAuthentication(context, admin) {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be signed in to use this feature.',
    );
  } else if (!context.auth.token.admin && admin) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'You must be an admin to use this feature.',
    );
  }
}

function dataValidator(data, validKeys) {
  if (Object.keys(data).length !== Object.keys(validKeys).length) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Data object contains invalid number of properties.',
    );
  } else {
    for (let key in data) {
      if (!validKeys[key] || typeof data[key] !== validKeys[key]) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Data object contains invalid properties.',
        );
      }
    }
  }
}

exports.createAuthor = functions.https.onCall(async (data, context) => {
  checkAuthentication(context, true);
  dataValidator(data, {
    authorName: 'string',
  });

  const db = admin.firestore();

  const author = await db
    .collection(collections.COLLECTION_AUTHORS)
    .where('name', '==', data.authorName)
    .limit(1)
    .get();

  if (!author.empty) {
    throw new functions.https.HttpsError(
      'already-exists',
      'This author already exists.',
    );
  }

  return db
    .collection(collections.COLLECTION_AUTHORS)
    .add({
      name: data.authorName,
    });
});

exports.createBook = functions.https.onCall(async (data, context) => {
  checkAuthentication(context, true);
  dataValidator(data, {
    authorId: 'string',
    bookCover: 'string',
    bookName: 'string',
    summary: 'string',
  });

  const mimeType = data.bookCover.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)[1];
  const base64EncodedImageString = data.bookCover.replace(/^data:image\/\w+;base64,/, '');
  const imageBuffer = new Buffer(base64EncodedImageString, 'base64');

  const filename = `bookCovers/${data.bookName}.${mimeTypes.detectExtension(mimeType)}`;
  const file = admin.storage().bucket().file(filename);
  await file.save(imageBuffer, { contentType: 'image/jpeg' });
  const fileUrl = await file.getSignedUrl({ action: 'read', expires: '03-09-2491' }).then(urls => urls[0]);

  const db = admin.firestore();

  return db
    .collection(collections.COLLECTION_BOOKS)
    .add({
      author: db.collection(collections.COLLECTION_AUTHORS).doc(data.authorId),
      imageUri: fileUrl,
      summary: data.summary,
      title: data.bookName,
    });
});

exports.createPublicProfile = functions.https.onCall(async (data, context) => {
  checkAuthentication(context);
  dataValidator(data, {
    firstname: 'string',
    lastname: 'string',
    username: 'string',
  });

  const db = admin.firestore();

  const userProfile = await db
    .collection(collections.COLLECTION_PUBLIC_PROFILES)
    .where('userId', '==', context.auth.uid)
    .limit(1)
    .get();

  if (userProfile.exists) {
    throw new functions.https.HttpsError(
      'already-exists',
      'This user already has a public profile.',
    );
  }

  const publicProfile = await db
    .collection(collections.COLLECTION_PUBLIC_PROFILES)
    .doc(data.username)
    .get();

  if (publicProfile.exists) {
    throw new functions.https.HttpsError(
      'already-exists',
      'This username already belongs to an existing user.',
    );
  }

  const user = await admin
    .auth()
    .getUser(context.auth.uid);

  if (user.email === functions.config().accounts.admin) {
    await admin
      .auth()
      .setCustomUserClaims(
        context.auth.uid,
        { admin: true },
      );
  }

  return db
    .collection(collections.COLLECTION_PUBLIC_PROFILES)
    .doc(data.username)
    .set({
      userId: context.auth.uid,
      firstName: data.firstname,
      lastName: data.lastname,
    });
});

exports.postComment = functions.https.onCall((data, context) => {
  checkAuthentication(context);
  dataValidator(data, {
    bookId: 'string',
    text: 'string',
  });

  const db = admin.firestore();

  return db
    .collection(collections.COLLECTION_PUBLIC_PROFILES)
    .where('userId', '==', context.auth.uid)
    .limit(1)
    .get()
    .then((snapshot) => {

      return db
        .collection(collections.COLLECTION_BOOK_COMMENTS)
        .add({
          text: data.text,
          username: snapshot.docs[0].id,
          dateCreated: new Date(),
          book: db.collection('books').doc(data.bookId),
        });
    });
});
