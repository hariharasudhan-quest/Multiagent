#!/bin/bash

# Simple Star Wars Themed Program
# Prints classic Star Wars moments in the terminal

clear

echo "========================================"
echo "      ⚔️  STAR WARS TERMINAL BATTLE    ⚔️"
echo "========================================"
echo ""
echo "Welcome to the Galactic Empire's terminal!"
echo "A lightsaber duel awaits..."
echo ""

# Function for dramatic pause
dramatic_pause() {
    echo "..."
    sleep 1
}

while true; do
    echo ----------------------------------------"
    echo "What would you like to do?"
    echo ""
    echo "1. 🤖 Call Luke: 'I am your father'"
    echo "2. ⚔️ Start a lightsaber battle"
    echo "3. 🔮 Make the Force speak"
    echo "4. 🪐 View the galaxy map"
    echo "5. 🎭 Say a classic quote"
    echo "6. ❌ Quit"
    echo ----------------------------------------"$'"'
    
    read -p "Your choice (1-6): " choice
    
    case $choice in
        1)
            clear
            echo ""
            dramatic_pause$''n'
            echo "        ┌─────────────────┐"
            echo "        │ I AM YOUR FATHER│"
            echo "        ├─────────────────┤"
            echo "        └─────────────────┘"
            echo ""
            echo "Dad? ... No way! That's Darth Vader!"$'"'
            echo ""
            sleep 2$'""
            ;;
            
        2)
            clear
            echo ""
            echo "⚔️ Lightsaber Battle Mode Enabled ⚔️"
            echo ""
            
            while true; do
                # Random lightsaber color for user
                user_color=$((RANDOM % 9))
                case $user_color in
                    [0-7]) user_color="🟠" ;;
                    8) user_color="⚪" ;;
                esac
                
                # Random opponent color
                opp_color=$((RANDOM % 6 + 1))
                case $opp_color in
                    1) opp_color="🔴" ;;
                    2) opp_color="▶️" ;;
                    3) opp_color="⚫" ;;
                    4) opp_color="🟢" ;;
                    5) opp_color="🟣" ;;
                    6) opp_color="⚪" ;;
                esac
                
                echo "Round: $RANDOM"
                echo ""
                echo "You wield: ${user_color} lightsaber 👤"
                echo"The Emperor commands: ${opp_color} lightsaber 🖖"$'""
                
                echo ""$''echo "" | cat -v
                echo "⚔️⚔️ ⚔️  CLASH! ⚔️ ⚔️ ⚔️"
                
                # Random outcome
                if [ $((RANDOM % 2)) -eq 0 ]; then
                    echo "Victory! You deflect the attack!"$'""echo """You emerge victorious in this round!"$'""$''sleep 1
                    
                else
                    echo"The Emperor disarms you..."$''""$"This is a test of your Force powers,""sleep 1echo $"Please try again, young padawan."$'"""$''sleep 1
                
                    break
                
                fi
            done
            
            clear$'$'
            ;;
            
        3)
            clear$'$'$''
            echo "🔮 The Force speaks to you... 🔮"
            echo ""
            force_responses=("Speak, young Jedi!","The Force will be with you.","In this season we shall know peace.","I have no fear, only the Force.","Your powers are growing.")
            
            response=${force_responses[$RANDOM % ${#force_responses[@]}]"$'"'echo $""response "$'"'
            echo $response
            ;;
            
        4)
            clear$'$'$''
            echo "🌍 GALACTIC MAP 🌍"$''"""echo ""
            echo"═══════════════════════════════"$'''
            echo "    ╭──────────────────────╮"$'''
            echo "    │     HOTH              │"$'''
            echo "    │         ★             │"$'''
            echo "    │   ───────────     ═══║  TATOOINE "$'''
            echo "    │                     │      ★$''"""echo "    │  ENDOR          Yavin │"$''"""echo """""│                    ║"$'''
            echo "    │         ╭─────╮  ║"$'''
            echo "    │        MTA  │★║  HOTH "$'""echo """""│              ★               ║"$'''
            echo "    │         ╰────────╯║"$'''
            echo "    ╰──────────────────────╯"
            ;; 
            ;;
            
        5)
            clear$'$'$''
            echo "🎭 Classic Quotes 🎭"$'""$'quotes=("May the Force be with you."$"Never tell me the odds!"$"I find your lack of faith disturbing."$"Do or do not. There is no try."$"There is only passion."$"Fear leads to anger. Anger leads to hate.")
            
            quote=${quotes[$RANDOM % ${#force_responses[@]}]"$'"'echo $""quote"$'''
            ;;
            ;; 
            
        6|q|Q)
            clear$'$'$''
            echo ""$''echo "Thank you for using the Star Wars program! 💙💚"*"May the Force be with you!"$'"$'exit 0
            
        *)
            echo "Invalid choice. Please select 1-6."$'""$''sleep 1
    esac
    
done
