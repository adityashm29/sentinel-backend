// const BEARER_TOKEN=process.env.X_API_BEARER;
const BEARER_TOKEN='AAAAAAAAAAAAAAAAAAAAAIMB9QEAAAAAKaDYYNcK%2Fwao6mGpicNuaWwkZLU%3DKdeC2KYenB0nmQzW4Gnb7UFyeoJaTX2MhXrsQdul91UnRdfmkl';
 type Tweet = {
  id: string;
  edit_history_tweet_ids: string[];
  text: string;
};
async function searchUserPosts(username:string) {

  try {
  const responseForID=await fetch(`https://api.x.com/2/users/by/username/${username}?user.fields=description`,
    { method:'GET',headers: { Authorization: `Bearer ${BEARER_TOKEN}` } }
  );
  const resp=await responseForID.json();
  console.log(resp);
  const description=resp.data.description;
  const id=resp.data.id;
  const response = await fetch(
    `https://api.x.com/2/users/${id}/tweets?max_results=10`,
    { method:'GET',headers: { Authorization: `Bearer ${BEARER_TOKEN}` } }
  );

  const data = await response.json();
  const previousTweets=data.map((tweet:Tweet)=>tweet.text);
    
}
  catch (error) {
    console.log("ERROR WHILE WORKING WITH THE API",error);
  }
 
}

// elon ki id 44196397

searchUserPosts('ThisIsBhandari');