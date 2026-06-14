//Segemented Bar Updater Script
//Event: On Awake
//Made by Yas AR
//
//Desicription:
/** SegmentedBarUpdaterScript.js : This script is created by Yas AR to help you create a life/ mana / stamina / energy / ... (you can choose for any type of progress bar) for your game.
 * You can use it for enemies, players, bosses, and more.
 * For more information about how to use the asset, you can watch this video: https://youtu.be/Iux_kOnMPtA or read the documentation file.
 * have fun! :D
 * 
 * */

//@input SceneObject[] segmentedBars // here you can set the life bars images (the amount of the bars is the amount of the life of the object)

if (!script.segmentedBars) {
    print("ERROR: Please set the life bars images on" + script.getSceneObject().name +"SceneObject");
    return;
}


script.life = script.segmentedBars.length; // This variable is the current life of the object and it's public so you can get it from other scripts

//Call damageEvent function to decrease the life of the object
//when you call this function from another script,
//it will decrease the life of the object by the damage amount 
//(here I give you the option to choose the amount of the damage but don't forget that every amount is a life bar (so if you send 2, it will decrease 2 life bars))
//also don't forget to add the damage amount parameter when you call the function)
script.damageEvent = function (damageAmount) { //the function is public so you can call it from another script //by importing this script to the other script or using behavior script (call api deprecated)

    //before decreasing the life, check if the object life is not zero
    if (script.life <= 0) {

        //if the object life is zero, then we will just print a message to the console
        print("The object life is zero, you can't decrease it anymore");
        print("are you serious?? you are trying to kill a dead guy??");
        print("He is like already dead, you can't kill him again");
        print("Bruh, Bro please let this guy rest in peace, he is already dead");
    } else {

        //now we will remove the damage amount from script.life
        script.life -= damageAmount; //decrease the life of the object by the damage amount

        //we made a last check to make sure that the object life is not zero after decreasing it
        if (script.life <= 0) {

            //now we will just disable all the life bars
            for (var i = 0; i < script.segmentedBars.length; i++) {
                script.segmentedBars[i].getChild(0).enabled = false;
            }

            //and also set the life of the object to zero
            script.life = 0;

        } else {

            //now we will disable every life bar that is equal or greater than the current life of the object
            for (var i = 0; i < script.segmentedBars.length; i++) {
                if (i >= script.life) {
                    //we don't need to disable the life bar it self, but we need to disable the child image
                    script.segmentedBars[i].getChild(0).enabled = false;
                }
            }

        }
    }


}


//Call healEvent function to increase the life of the object
//when you call this function from another script,
//it will increase the life of the object by the heal amount
//(here I give you the option to choose the amount of the heal but don't forget that every amount is a life bar (so if you send 2, it will increase 2 life bars))
//also don't forget to add the heal amount parameter when you call the function)
script.healEvent = function (healAmount) { //the function is public so you can call it from another script //by importing this script to the other script or using behavior script (call api deprecated)

    //before increasing the life, check if the object life is not equal to the max life
    if (script.life >= script.segmentedBars.length) {

        //If needed you can add your events here
        //ADD YOUR EVENT HERE (CODE)
        //if the object life is equal to the max life, then we will just print a message to the console
        print("The object life is already full, you can't increase it anymore");
        print("are you serious?? you are trying to heal a full life guy??");

    } else {

        //now we will add the heal amount to script.life
        script.life += healAmount; //increase the life of the object by the heal amount

        //we made a last check to make sure that the object life is not equal to the max life after increasing it
        if (script.life >= script.segmentedBars.length) {

            //now we will just enable all the life bars
            for (var i = 0; i < script.segmentedBars.length; i++) {
                script.segmentedBars[i].getChild(0).enabled = true;
            }

            //and also set the life of the object to the max life
            script.life = script.segmentedBars.length;
        }
        else {

            //now we will enable every life bar that is equal or less than the current life of the object
            for (var i = 0; i < script.segmentedBars.length; i++) {
                if (i < script.life) {
                    //we don't need to enable the life bar it self, but we need to enable the child image
                    script.segmentedBars[i].getChild(0).enabled = true;
                }
            }

        }

    }
}
