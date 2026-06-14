//Coninuous Bar Updater Script
// Version: 1.0
//Event: On Awake
//Made by Yas AR

//Desicription:
/** Continuous Bar Updater Script: This script is created by Yas AR to help you create a life/ mana / stamina / energy / ... (you can choose for any type of progress bar) for your game.
 * You can use it for enemies, players, bosses, and more.
 * For more information about how to use the asset, you can watch this video: https://youtu.be/Iux_kOnMPtA or read the documentation file.
 * have fun! :D
 **/

//@input SceneObject progressBar // here you can set the progress bar image (the image that will get damaged)
//@input int maxLife = 100 {"min":1, "max":1000} // here you can set the max life of the object
//@input Component.Text progressionText // here you can set the text that will show the current life of the object (you can leave it empty if you don't want to use it)
//@input bool startFromMaxAmount = true // here you can set if you want to start the life bar from the max amount or not (if you set it to false, then the life bar will start from zero)

if (!script.progressBar) {
    print("ERROR: Please set the progress bar image on" + script.getSceneObject().name + "SceneObject");
    return;
}


//Here we will check what you want to do with the resource bar (start from max amount or not) (maybe you want to use it like a Life bar or a Xp bar)
if (script.startFromMaxAmount) {

    //here you want to start with the max amount of the resource bar

    script.life = script.maxLife; // This variable is the current life of the object and it's public so you can get it from other scripts

} else {

    //here you want to start with zero amount of the resource bar and later fill it

    script.life = 0; // This variable is the current life of the object and it's public so you can get it from other scripts

    script.progressBar.getComponent("Component.ScreenTransform").anchors.right = -1; //change the right anchor of the life bar image to 0%
}


if (script.progressionText != null) {

    //if the text component is not empty, then we will change the text to show the current life of the object
    script.progressionText.text = script.life + "/" + script.maxLife; //change the text to show the current life of the object
    
   
}


//Call damageEvent function to decrease the life of the object
//when you call this function from another script, 
//it will decrease the life of the object by the damage amount 
//so don't forget to add the damage amount parameter when you call the function)
script.damageEvent = function (damageAmount) { //the function is public so you can call it from another script //by importing this script to the other script or using behavior script (call api deprecated)

    //before decreasing the life, check if the object life is not zero
    if (script.life <= 0) {

        //if the object life is zero, then we will just print a message to the console
        print("The object life is zero, you can't decrease it anymore");
        print("Bro this guy is dead, you can't kill him again??");
        print("why are trying to kill a dead guy?? D= wha's wrong with you??");
        print("I'm not gonna decrease the life of a dead guy, you can't kill him again");
        print("Bruh")

    } else {

        script.life -= damageAmount; //decrease the life of the object by the damage amount
       // print("The object life is now: " + script.life); //print the current life of the object to the console

        //Here we will change the text to show the current life of the object
        //before changing the text, we will check if the text component is not empty
        if (script.progressionText != null) {

            //if the text component is not empty, then we will change the text to show the current life of the object
            script.progressionText.text = script.life + "/" + script.maxLife; //change the text to show the current life of the object
        }

        //we made a last check to make sure that the object life is not zero after decreasing it
        if (script.life <= 0) {

            //now you just killed the object, so we will just put the life image to -1 to make it empty
            script.progressBar.getComponent("Component.ScreenTransform").anchors.right = -1; //change the right anchor of the life bar image to zero

            //and also set the life of the object to zero
            script.life = 0;

        } else {

            // now we will change the life bar size to match the current life of the object
            // we will do that by changing the anchors of the life bar image

            //we can use a simple math equation to calculate the anchors of the life bar image

            var progressBarAmountToReduce = ((damageAmount / script.maxLife) * 2); //calculate the amount of the life bar image to reduce
           // print("The life bar amount to reduce is: " + progressBarAmountToReduce)


            script.progressBar.getComponent("Component.ScreenTransform").anchors.right -= progressBarAmountToReduce; //change the right anchor of the life bar image to match the current life of the object

        }
    }
}


//Call healEvent function to increase the life of the object
//when you call this function from another script,
//it will increase the life of the object by the heal amount
//so don't forget to add the heal amount parameter when you call the function)
script.healEvent = function (healAmount) { //the function is public so you can call it from another script //by importing this script to the other script or using behavior script (call api deprecated)

    //before increasing the life, check if the object life is not equal to the max life
    if (script.life >= script.maxLife) {

        //we will just print a message to the console (if you want you can add here a event)
        //ADD YOUR EVENT HERE

        print("The object life is already full, you can't increase it anymore");
        print("Bro this guy is already full, you can't heal him again??");
        print("why are trying to heal a full LIFE guy?? D= you are wasting your heal");
    } else {

        script.life += healAmount; //increase the life of the object by the heal amount
       // print("The object life is now: " + script.life); //print the current life of the object to the console

        //Here we will change the text to show the current life of the object
        //before changing the text, we will check if the text component is not empty
        if (script.progressionText != null) {

            //if the text component is not empty, then we will change the text to show the current life of the object
            script.progressionText.text = script.life + "/" + script.maxLife; //change the text to show the current life of the object
        }

        //we made a last check to make sure that the object life is not equal to the max life after increasing it
        if (script.life >= script.maxLife) {

            //now you just healed the object, so we will just put the life image to 0 to make it full
            script.progressBar.getComponent("Component.ScreenTransform").anchors.right = 1; //change the right anchor of the life bar image to 1 (the full image amount)

            //and also set the life of the object to the max life
            script.life = script.maxLife;

        } else {

            // now we will change the life bar size to match the current life of the object
            // we will do that by changing the anchors of the life bar image

            //we can use a simple math equation to calculate the anchors of the life bar image

            var progressBarAmountToIncrease = ((healAmount / script.maxLife) * 2); //calculate the amount of the life bar image to increase
          //  print("The life bar amount to increase is: " + progressBarAmountToIncrease)

            script.progressBar.getComponent("Component.ScreenTransform").anchors.right += progressBarAmountToIncrease; //change the right anchor of the life bar image to match the current life of the object

        }
    }
}